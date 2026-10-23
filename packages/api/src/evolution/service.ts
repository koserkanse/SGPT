import { Cron } from 'croner';
import { randomUUID } from 'node:crypto';
import { logger } from '@librechat/data-schemas';
import type {
  CopilotConfig,
  EvolutionConfig,
  EvolutionScope,
  EvolutionState,
  EvolutionStatus,
  EvolutionTopic,
  EvolutionSource,
  EvolutionLesson,
  EvolutionFinding,
  EvolutionRun,
} from 'librechat-data-provider';
import type { EvolutionStore } from '@librechat/data-schemas';
import type { Evaluator, EvaluationResult } from './evaluate';
import type { CopilotUser } from '../copilot/policy';
import { createEvaluator, evaluationContext, learningContext } from './evaluate';
import { financialEvidence, presentationEvidence } from './artifacts';
import { canUseCopilot } from '../copilot/policy';
import { createGitHubResearch } from './github';
import { retainedMethod } from './catalog';
import { EvolutionError } from './http';

type Dependencies = {
  store: EvolutionStore;
  getConfig: () => Promise<CopilotConfig | undefined>;
  research?: ReturnType<typeof createGitHubResearch>;
  evaluate?: Evaluator;
  now?: () => Date;
};
type Settings = { config: EvolutionConfig; scope: EvolutionScope; copilot: CopilotConfig };
export const scheduleKey = (config: EvolutionConfig): string =>
  JSON.stringify([config.timezone, config.days, config.hour, config.minute]);
export function nextResearchAt(config: EvolutionConfig, after: Date): string {
  const cron = new Cron(`${config.minute} ${config.hour} * * ${config.days.join(',')}`, {
    timezone: config.timezone,
    paused: true,
  });
  const next = cron.nextRun(after);
  if (!next) throw new EvolutionError('INVALID_SCHEDULE');
  return next.toISOString();
}
const sourceKey = (source: EvolutionSource) => `${source.topic}:${source.digest}`;
const scopeMatches = (scope: EvolutionScope, user: CopilotUser) =>
  scope.ownerUserId === user.id && scope.tenantId === (user.tenantId ?? '');
export const safeEvolutionCode = (error: unknown) =>
  error instanceof EvolutionError ? error.code : 'EVOLUTION_FAILED';

export function createEvolutionService(deps: Dependencies) {
  let closing = false;
  const now = deps.now ?? (() => new Date());
  const research = deps.research ?? createGitHubResearch();
  const evaluate = deps.evaluate ?? createEvaluator();
  const inFlight = new Map<string, { abort: AbortController; done: Promise<void> }>();
  const settings = async (user?: CopilotUser): Promise<Settings> => {
    const copilot = await deps.getConfig();
    const config = copilot?.evolution;
    if (!copilot?.enabled || !config?.enabled) throw new EvolutionError('EVOLUTION_DISABLED');
    const scope = { ownerUserId: config.ownerUserId, tenantId: config.tenantId };
    if (user && (!scopeMatches(scope, user) || !canUseCopilot(copilot, user)))
      throw new EvolutionError('EVOLUTION_ACCESS_DENIED');
    const owner = await deps.store.owner(scope);
    if (!owner || !canUseCopilot(copilot, owner))
      throw new EvolutionError('EVOLUTION_ACCESS_DENIED');
    return { config, scope, copilot };
  };
  const persist = async (s: Settings, state: EvolutionState, runId: string | null) => {
    if (!(await deps.store.save(s.scope, state, runId, now())))
      throw new EvolutionError('EVOLUTION_CONFLICT');
  };
  const alignSchedule = async (s: Settings, state: EvolutionState) => {
    if (state.scheduleKey === scheduleKey(s.config) && state.nextRunAt) return;
    state.scheduleKey = scheduleKey(s.config);
    state.nextRunAt = nextResearchAt(s.config, now());
    await persist(s, state, null);
  };
  const saveEvidence = async (s: Settings, result: EvaluationResult) => {
    for (const artifact of result.artifacts) {
      if (Buffer.byteLength(artifact.data, 'base64') > s.config.maxArtifactBytes)
        throw new EvolutionError('ARTIFACT_TOO_LARGE');
      await deps.store.saveArtifact(
        s.scope,
        artifact,
        new Date(now().getTime() + s.config.artifactRetentionDays * 86400000),
      );
    }
  };
  const perform = async (
    s: Settings,
    state: EvolutionState,
    run: EvolutionRun,
    signal: AbortSignal,
  ) => {
    const record = async (finding: EvolutionFinding) => {
      run.findings.push(finding);
      await persist(s, state, run.id);
    };
    const topics = [...s.config.topics].sort(
      (a, b) =>
        Number(!['presentations', 'finance'].includes(a)) -
        Number(!['presentations', 'finance'].includes(b)),
    );
    try {
      for (const topic of topics) {
        signal.throwIfAborted();
        try {
          const sources = await research(topic, s.config, signal);
          if (!sources.length) await record({ topic, repository: '', url: '', result: 'retained' });
          let incumbent: EvaluationResult | undefined;
          for (const source of sources) {
            signal.throwIfAborted();
            const common = {
              topic,
              repository: source.repository,
              commit: source.commit,
              url: source.url,
            };
            if (!s.config.allowedLicenses.includes(source.license)) {
              await record({ ...common, result: 'source_rejected' });
              continue;
            }
            if (!source.compatible || source.kind !== 'skill') {
              await record({ ...common, result: 'unsupported_adapter' });
              continue;
            }
            if (
              state.blocked.includes(sourceKey(source)) ||
              state.active[topic]?.source.digest === source.digest
            ) {
              await record({ ...common, result: 'retained' });
              continue;
            }
            if (
              !s.config.apiKey ||
              (['presentations', 'finance'].includes(topic) && !s.config.libreOfficePath) ||
              (topic === 'presentations' && !s.config.pdfTextPath)
            ) {
              await record({ ...common, result: 'setup_required' });
              continue;
            }
            incumbent ??= await evaluate(
              topic,
              state.active[topic]?.source,
              state.lessons,
              s.config,
              signal,
            );
            if (incumbent.evaluation.context !== evaluationContext(s.config, topic, state.lessons))
              throw new EvolutionError('EVALUATOR_CONTEXT_MISMATCH');
            await saveEvidence(s, incumbent);
            const candidate = await evaluate(topic, source, state.lessons, s.config, signal);
            await saveEvidence(s, candidate);
            if (
              candidate.evaluation.context !== incumbent.evaluation.context ||
              candidate.evaluation.suite !== incumbent.evaluation.suite
            )
              throw new EvolutionError('EVALUATOR_CONTEXT_MISMATCH');
            const evidence = {
              score: candidate.evaluation.score,
              checks: candidate.evaluation.checks,
              artifactIds: candidate.evaluation.artifactIds,
            };
            if (!candidate.evaluation.passed) {
              await record({ ...common, ...evidence, result: 'failed_tests' });
              continue;
            }
            if (
              candidate.evaluation.score <
              incumbent.evaluation.score + s.config.improvementMargin
            ) {
              await record({ ...common, ...evidence, result: 'retained' });
              continue;
            }
            const lesson: EvolutionLesson = {
              id: randomUUID(),
              topic,
              text: retainedMethod[topic],
              source: `${run.id}:${source.repository}@${source.commit}`,
              createdAt: now().toISOString(),
              validated: true,
            };
            const learned = state.lessons.some(
              (entry) => entry.topic === topic && entry.text === lesson.text,
            )
              ? state.lessons
              : [...state.lessons, lesson].slice(-s.config.retainedLessons);
            // Validate the final composed skill, including retained learning, before atomic activation.
            const verified = await evaluate(topic, source, learned, s.config, signal);
            await saveEvidence(s, verified);
            if (
              !verified.evaluation.passed ||
              verified.evaluation.score < incumbent.evaluation.score + s.config.improvementMargin
            ) {
              state.blocked = [...state.blocked, sourceKey(source)].slice(
                -s.config.retainedBlockedVersions,
              );
              await record({ ...common, ...evidence, result: 'failed_tests' });
              continue;
            }
            const current = await settings();
            if (JSON.stringify(current.config) !== JSON.stringify(s.config))
              throw new EvolutionError('EVOLUTION_CONFIG_CHANGED');
            const previous = state.active[topic];
            if (previous)
              state.previous[topic] = [previous, ...(state.previous[topic] ?? [])].slice(
                0,
                s.config.retainedVersions,
              );
            state.active[topic] = {
              id: randomUUID(),
              source,
              evaluation: verified.evaluation,
              activatedAt: now().toISOString(),
            };
            state.lessons = learned;
            await record({
              ...common,
              score: verified.evaluation.score,
              checks: verified.evaluation.checks,
              artifactIds: verified.evaluation.artifactIds,
              result: 'promoted',
            });
            // Read the actual deployed registry binding, then verify it again.
            const deployed = await deps.store.read(s.scope);
            let health: EvaluationResult;
            try {
              health = await evaluate(
                topic,
                deployed.active[topic]?.source,
                deployed.lessons,
                s.config,
                signal,
              );
            } catch (error) {
              if (previous) state.active[topic] = previous;
              else delete state.active[topic];
              if (previous) state.previous[topic] = (state.previous[topic] ?? []).slice(1);
              await record({ ...common, result: 'rolled_back' });
              throw error;
            }
            await saveEvidence(s, health);
            if (!health.evaluation.passed) {
              if (previous) state.active[topic] = previous;
              else delete state.active[topic];
              if (previous) state.previous[topic] = (state.previous[topic] ?? []).slice(1);
              state.blocked = [...state.blocked, sourceKey(source)].slice(
                -s.config.retainedBlockedVersions,
              );
              await record({
                ...common,
                score: health.evaluation.score,
                checks: health.evaluation.checks,
                artifactIds: health.evaluation.artifactIds,
                result: 'rolled_back',
              });
              incumbent = undefined;
            } else incumbent = health;
          }
        } catch (error) {
          signal.throwIfAborted();
          if (
            error instanceof EvolutionError &&
            ['EVOLUTION_CONFLICT', 'EVOLUTION_CONFIG_CHANGED'].includes(error.code)
          )
            throw error;
          await record({
            topic,
            repository: '',
            url: '',
            result:
              error instanceof EvolutionError &&
              ['MODEL_SETUP_REQUIRED', 'RENDERER_REQUIRED', 'PDF_TOOLS_REQUIRED'].includes(
                error.code,
              )
                ? 'setup_required'
                : 'research_failed',
          });
        }
      }
      run.status = 'completed';
      if (run.findings.some((finding) => finding.result === 'research_failed')) {
        run.status = 'failed';
        run.code = 'RESEARCH_INCOMPLETE';
      }
    } catch (error) {
      run.status = signal.aborted ? 'cancelled' : 'failed';
      run.code = signal.aborted ? 'EVOLUTION_CANCELLED' : safeEvolutionCode(error);
    }
    run.finishedAt = now().toISOString();
    if (run.trigger === 'schedule') state.nextRunAt = nextResearchAt(s.config, now());
    try {
      await persist(s, state, run.id);
    } catch (error) {
      if (!(error instanceof EvolutionError && error.code === 'EVOLUTION_CONFLICT')) throw error;
    } finally {
      await deps.store.release(s.scope, run.id);
    }
  };
  const start = async (
    trigger: 'manual' | 'schedule',
    user?: CopilotUser,
  ): Promise<{ id: string } | null> => {
    if (closing) throw new EvolutionError('EVOLUTION_STOPPED');
    const s = await settings(user);
    let state = await deps.store.read(s.scope);
    if (state.paused) throw new EvolutionError('EVOLUTION_PAUSED');
    if (await deps.store.busy(s.scope, now())) throw new EvolutionError('EVOLUTION_BUSY');
    await alignSchedule(s, state);
    if (trigger === 'schedule' && (!state.nextRunAt || new Date(state.nextRunAt) > now()))
      return null;
    const id = randomUUID();
    if (
      !(await deps.store.claim(
        s.scope,
        id,
        new Date(now().getTime() + s.config.runTimeoutMs + 60000),
        now(),
      ))
    )
      throw new EvolutionError('EVOLUTION_BUSY');
    try {
      state = await deps.store.read(s.scope);
      if (closing) throw new EvolutionError('EVOLUTION_STOPPED');
      if (state.paused) throw new EvolutionError('EVOLUTION_PAUSED');
      if (trigger === 'schedule' && (!state.nextRunAt || new Date(state.nextRunAt) > now())) {
        await deps.store.release(s.scope, id);
        return null;
      }
      for (const stale of state.runs.filter((run) => run.status === 'running')) {
        stale.status = 'failed';
        stale.code = 'WORKER_RESTARTED';
        stale.finishedAt = now().toISOString();
      }
      const run: EvolutionRun = {
        id,
        startedAt: now().toISOString(),
        trigger,
        status: 'running',
        findings: [],
      };
      state.runs = [run, ...state.runs].slice(0, s.config.retainedRuns);
      await persist(s, state, id);
      if (closing) {
        run.status = 'cancelled';
        run.code = 'EVOLUTION_STOPPED';
        run.finishedAt = now().toISOString();
        await persist(s, state, id);
        throw new EvolutionError('EVOLUTION_STOPPED');
      }
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), s.config.runTimeoutMs);
      timeout.unref();
      const done = perform(s, state, run, abort.signal).finally(() => {
        clearTimeout(timeout);
        inFlight.delete(id);
      });
      // The owner can inspect the durable run; a detached job must not crash the process.
      void done.catch((error) =>
        logger.error('[Evolution] Job persistence failed', { code: safeEvolutionCode(error) }),
      );
      inFlight.set(id, { abort, done });
      return { id };
    } catch (error) {
      await deps.store.release(s.scope, id);
      throw error;
    }
  };
  return {
    start,
    async status(user: CopilotUser): Promise<EvolutionStatus> {
      const s = await settings(user);
      const state = await deps.store.read(s.scope);
      const running = await deps.store.busy(s.scope, now());
      if (!running) await alignSchedule(s, state);
      const setup = [
        ...(!s.config.apiKey ? ['MODEL_SETUP_REQUIRED'] : []),
        ...(!s.config.libreOfficePath &&
        s.config.topics.some((topic) => ['presentations', 'finance'].includes(topic))
          ? ['RENDERER_REQUIRED']
          : []),
        ...(!s.config.pdfTextPath && s.config.topics.includes('presentations')
          ? ['PDF_TOOLS_REQUIRED']
          : []),
      ];
      return {
        enabled: true,
        ready: !setup.length,
        timezone: s.config.timezone,
        days: s.config.days,
        hour: s.config.hour,
        minute: s.config.minute,
        topics: s.config.topics,
        state,
        running,
        setup,
      };
    },
    async mutate(
      user: CopilotUser,
      change: (state: EvolutionState, config: EvolutionConfig) => void,
    ): Promise<void> {
      const s = await settings(user);
      const state = await deps.store.read(s.scope);
      change(state, s.config);
      await persist(s, state, null);
    },
    async rollback(user: CopilotUser, topic: EvolutionTopic): Promise<void> {
      const s = await settings(user);
      const state = await deps.store.read(s.scope);
      const current = state.active[topic];
      if (!current) throw new EvolutionError('NO_ACTIVE_VERSION');
      state.blocked = [...state.blocked, sourceKey(current.source)].slice(
        -s.config.retainedBlockedVersions,
      );
      const [previous, ...rest] = state.previous[topic] ?? [];
      if (previous) state.active[topic] = previous;
      else delete state.active[topic];
      state.previous[topic] = rest;
      state.lessons = [
        ...state.lessons,
        {
          id: randomUUID(),
          topic,
          text: `Version ${current.source.commit} was rolled back by the owner; do not reactivate this exact source digest.`,
          source: 'owner-rollback',
          createdAt: now().toISOString(),
          validated: false,
        },
      ].slice(-s.config.retainedLessons);
      await persist(s, state, null);
    },
    async cancel(user: CopilotUser): Promise<void> {
      const s = await settings(user);
      const state = await deps.store.read(s.scope);
      const run = state.runs.find((entry) => entry.status === 'running');
      if (!run) return;
      run.status = 'cancelled';
      run.code = 'EVOLUTION_CANCELLED';
      run.finishedAt = now().toISOString();
      await persist(s, state, run.id);
      await deps.store.release(s.scope, run.id);
      inFlight.get(run.id)?.abort.abort();
    },
    async learn(
      user: CopilotUser,
      input: { topic: EvolutionTopic; text: string; supersedes?: string },
    ): Promise<void> {
      const s = await settings(user);
      const state = await deps.store.read(s.scope);
      if (
        input.supersedes &&
        !state.lessons.some((entry) => entry.id === input.supersedes && entry.topic === input.topic)
      )
        throw new EvolutionError('INVALID_LESSON_REFERENCE');
      if (!s.config.topics.includes(input.topic)) throw new EvolutionError('INVALID_TOPIC');
      state.lessons = [
        ...state.lessons,
        {
          ...input,
          id: randomUUID(),
          source: 'owner',
          validated: false,
          createdAt: now().toISOString(),
        },
      ].slice(-s.config.retainedLessons);
      await persist(s, state, null);
    },
    async runtimeContext(user: CopilotUser): Promise<string> {
      try {
        const s = await settings(user);
        const state = await deps.store.read(s.scope);
        return JSON.stringify({
          capabilities: Object.values(state.active)
            .filter((version) => s.config.topics.includes(version.source.topic))
            .map((version) => ({ topic: version.source.topic, commit: version.source.commit })),
        });
      } catch (error) {
        if (
          error instanceof EvolutionError &&
          ['EVOLUTION_DISABLED', 'EVOLUTION_ACCESS_DENIED'].includes(error.code)
        )
          return '';
        throw error;
      }
    },
    async loadSkill(user: CopilotUser, topic: EvolutionTopic) {
      const s = await settings(user);
      const state = await deps.store.read(s.scope);
      if (!s.config.topics.includes(topic)) throw new EvolutionError('INVALID_TOPIC');
      const source = state.active[topic]?.source;
      return {
        topic,
        source: source
          ? {
              repository: source.repository,
              commit: source.commit,
              instructions: source.content,
              references: source.files,
            }
          : null,
        retainedMethods: learningContext(topic, state.lessons),
      };
    },
    async createArtifact(user: CopilotUser, topic: 'presentations' | 'finance', value: unknown) {
      const s = await settings(user);
      const signal = AbortSignal.timeout(s.config.requestTimeoutMs);
      const result =
        topic === 'presentations'
          ? await presentationEvidence(value, s.config, signal)
          : await financialEvidence(value, s.config, signal);
      if (result.checks.some((check) => !check.passed))
        throw new EvolutionError('ARTIFACT_VALIDATION_FAILED');
      for (const artifact of result.artifacts) {
        if (Buffer.byteLength(artifact.data, 'base64') > s.config.maxArtifactBytes)
          throw new EvolutionError('ARTIFACT_TOO_LARGE');
        await deps.store.saveArtifact(
          s.scope,
          artifact,
          new Date(now().getTime() + s.config.artifactRetentionDays * 86400000),
        );
      }
      return result.artifacts.map(({ id, name }) => ({ id, name }));
    },
    async artifact(user: CopilotUser, id: string) {
      const s = await settings(user);
      return deps.store.getArtifact(s.scope, id);
    },
    async tick() {
      try {
        await start('schedule');
      } catch (error) {
        if (
          !(
            error instanceof EvolutionError &&
            [
              'EVOLUTION_BUSY',
              'EVOLUTION_DISABLED',
              'EVOLUTION_PAUSED',
              'EVOLUTION_ACCESS_DENIED',
              'EVOLUTION_CONFLICT',
              'EVOLUTION_STOPPED',
            ].includes(error.code)
          )
        )
          throw error;
      }
    },
    async drain() {
      await Promise.all([...inFlight.values()].map((job) => job.done));
    },
    async stop() {
      closing = true;
      for (const job of inFlight.values()) job.abort.abort();
      await Promise.all([...inFlight.values()].map((job) => job.done));
    },
  };
}
export type EvolutionService = ReturnType<typeof createEvolutionService>;
