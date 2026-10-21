import { useRef, useState } from 'react';
import { Button, Spinner } from '@librechat/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataService, QueryKeys, MutationKeys } from 'librechat-data-provider';
import type { EvolutionTopic } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

export const topicLabels = {
  presentations: 'com_evolution_presentations',
  finance: 'com_evolution_finance',
  'generative-ui': 'com_evolution_generative_ui',
  agents: 'com_evolution_agents',
  mcp: 'com_evolution_mcp',
  memory: 'com_evolution_memory',
  documents: 'com_evolution_documents',
  'sales-crm': 'com_evolution_sales_crm',
} as const;

export function ArtifactDownload({ id, name }: { id: string; name?: string }) {
  const localize = useLocalize();
  const download = useMutation({
    mutationKey: [MutationKeys.evolution, 'artifact', id],
    mutationFn: () => dataService.getEvolutionArtifact(id),
    onSuccess: ({ blob, name }) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={download.isLoading}
        onClick={() => download.mutate()}
      >
        {name ?? localize('com_evolution_artifact')}
      </Button>
      {download.isError && <span role="alert">{localize('com_evolution_artifact_error')}</span>}
    </span>
  );
}

export default function Evolution({ userId }: { userId: string }) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const methodInput = useRef<HTMLTextAreaElement>(null);
  const [topic, setTopic] = useState<EvolutionTopic>('presentations');
  const [text, setText] = useState('');
  const [supersedes, setSupersedes] = useState<string>();
  const queryKey = [QueryKeys.evolution, userId];
  const status = useQuery({
    queryKey,
    queryFn: dataService.getEvolutionStatus,
    retry: false,
    refetchInterval: (data) => (data?.running ? 5000 : 30000),
  });
  const action = useMutation({
    mutationKey: [MutationKeys.evolution, userId],
    mutationFn: async (command: {
      type: 'run' | 'cancel' | 'pause' | 'rollback' | 'learn';
      topic?: EvolutionTopic;
    }) => {
      if (command.type === 'run') await dataService.runEvolution();
      else if (command.type === 'cancel') await dataService.cancelEvolution();
      else if (command.type === 'pause')
        await dataService.pauseEvolution(!status.data?.state.paused);
      else if (command.type === 'rollback' && command.topic)
        await dataService.rollbackEvolution(command.topic);
      else if (command.type === 'learn') {
        await dataService.learnEvolution({ topic, text, ...(supersedes ? { supersedes } : {}) });
        setText('');
        setSupersedes(undefined);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries(queryKey);
    },
  });
  if (status.isLoading)
    return (
      <div role="status" className="p-6">
        <Spinner />
        <span className="sr-only">{localize('com_copilot_loading')}</span>
      </div>
    );
  if (status.isError || !status.data)
    return (
      <div role="alert" className="space-y-3 p-6">
        <p>{localize('com_evolution_load_error')}</p>
        <Button onClick={() => void status.refetch()}>{localize('com_ui_retry')}</Button>
      </div>
    );
  const data = status.data;
  const busy = data.running || action.isLoading;
  const date = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: data.timezone,
    }).format(new Date(value));
  let scheduleLabel: 'com_evolution_running' | 'com_evolution_paused' | 'com_evolution_scheduled' =
    'com_evolution_scheduled';
  if (data.running) scheduleLabel = 'com_evolution_running';
  else if (data.state.paused) scheduleLabel = 'com_evolution_paused';
  return (
    <section
      className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 md:p-6"
      aria-label={localize('com_evolution_title')}
    >
      <div className="max-w-5xl space-y-3">
        <h2 className="text-xl font-semibold">{localize('com_evolution_title')}</h2>
        <p className="text-text-secondary">{localize('com_evolution_description')}</p>
        <p role="status">{localize(scheduleLabel)}</p>
        {data.state.nextRunAt && (
          <p className="text-text-secondary text-sm">
            {localize('com_evolution_next')}: {date(data.state.nextRunAt)} ({data.timezone})
          </p>
        )}
        {!data.ready && (
          <div role="status" className="border-border-light space-y-1 rounded-lg border p-3">
            {data.setup.includes('MODEL_SETUP_REQUIRED') && (
              <p>{localize('com_evolution_model_setup')}</p>
            )}
            {data.setup.some((code) => code !== 'MODEL_SETUP_REQUIRED') && (
              <p>{localize('com_evolution_renderer_setup')}</p>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || data.state.paused}
            onClick={() => action.mutate({ type: 'run' })}
          >
            {localize('com_evolution_run')}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => action.mutate({ type: 'pause' })}
          >
            {localize(data.state.paused ? 'com_evolution_resume' : 'com_evolution_pause')}
          </Button>
          {data.running && (
            <Button
              variant="outline"
              disabled={action.isLoading}
              onClick={() => action.mutate({ type: 'cancel' })}
            >
              {localize('com_evolution_cancel')}
            </Button>
          )}
        </div>
        {action.isError && <p role="alert">{localize('com_evolution_action_error')}</p>}
      </div>
      <div className="max-w-5xl">
        {data.topics.map((topic) => {
          const active = data.state.active[topic];
          return (
            <article
              key={topic}
              className="border-border-light grid items-start gap-2 border-b py-3 md:grid-cols-3"
            >
              <div>
                <h3 className="font-semibold">{localize(topicLabels[topic])}</h3>
                {['presentations', 'finance'].includes(topic) && (
                  <p className="text-text-secondary text-sm">
                    {localize('com_evolution_priority')}
                  </p>
                )}
              </div>
              {active ? (
                <>
                  <div>
                    <a
                      className="underline"
                      href={active.source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {active.source.repository}
                    </a>
                    <p className="text-text-secondary text-sm break-all">
                      {active.source.commit.slice(0, 12)} ·{' '}
                      {Math.round(active.evaluation.score * 100)}%
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    className="justify-self-start md:justify-self-end"
                    onClick={() => action.mutate({ type: 'rollback', topic })}
                  >
                    {localize('com_evolution_rollback')}
                  </Button>
                </>
              ) : (
                <p className="text-text-secondary text-sm">{localize('com_evolution_baseline')}</p>
              )}
            </article>
          );
        })}
      </div>
      <section className="max-w-5xl space-y-3" aria-label={localize('com_evolution_learning')}>
        <h3 className="text-lg font-semibold">{localize('com_evolution_learning')}</h3>
        <p className="text-text-secondary text-sm">
          {localize('com_evolution_learning_description')}
        </p>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            action.mutate({ type: 'learn' });
          }}
        >
          <label className="block">
            {localize('com_evolution_topic')}
            <select
              className="bg-surface-primary border-border-light mt-1 block rounded border p-2"
              value={topic}
              disabled={busy || !!supersedes}
              onChange={(event) => setTopic(event.target.value as EvolutionTopic)}
            >
              {data.topics.map((id) => (
                <option key={id} value={id}>
                  {localize(topicLabels[id])}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            {localize('com_evolution_method')}
            <textarea
              ref={methodInput}
              className="bg-surface-primary border-border-light mt-1 block w-full rounded border p-2"
              rows={3}
              minLength={3}
              maxLength={1000}
              value={text}
              disabled={busy}
              onChange={(event) => setText(event.target.value)}
              required
            />
          </label>
          <Button variant="outline" type="submit" disabled={busy || text.trim().length < 3}>
            {localize(supersedes ? 'com_evolution_save_correction' : 'com_evolution_save_method')}
          </Button>
          {supersedes && (
            <Button
              variant="outline"
              type="button"
              disabled={busy}
              onClick={() => {
                setSupersedes(undefined);
                setText('');
              }}
            >
              {localize('com_evolution_cancel_correction')}
            </Button>
          )}
        </form>
        {!data.state.lessons.length && (
          <p className="text-text-secondary">{localize('com_evolution_no_lessons')}</p>
        )}
        {data.state.lessons
          .filter((lesson) => !data.state.lessons.some((entry) => entry.supersedes === lesson.id))
          .map((lesson) => (
            <article key={lesson.id} className="border-border-light rounded-lg border p-3">
              <p className="font-medium">{localize(topicLabels[lesson.topic])}</p>
              <p className="whitespace-pre-wrap">{lesson.text}</p>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setTopic(lesson.topic);
                  setText(lesson.text);
                  setSupersedes(lesson.id);
                  methodInput.current?.focus({ preventScroll: true });
                  methodInput.current?.scrollIntoView?.({ block: 'center', behavior: 'auto' });
                }}
              >
                {localize('com_evolution_correct_method')}
              </Button>
              <p className="text-text-secondary text-xs">
                {localize(
                  lesson.validated
                    ? 'com_evolution_validated_method'
                    : 'com_evolution_owner_method',
                )}{' '}
                · {date(lesson.createdAt)}
              </p>
            </article>
          ))}
      </section>
      <section className="max-w-5xl space-y-3" aria-label={localize('com_evolution_history')}>
        <h3 className="text-lg font-semibold">{localize('com_evolution_history')}</h3>
        {!data.state.runs.length && (
          <p className="text-text-secondary">{localize('com_evolution_no_runs')}</p>
        )}
        {data.state.runs.map((run) => (
          <article key={run.id} className="border-border-light space-y-2 rounded-lg border p-4">
            <h4 className="font-medium">
              {date(run.startedAt)} · {localize(`com_evolution_status_${run.status}`)}
            </h4>
            {run.findings.map((finding, index) => (
              <div
                key={`${finding.topic}:${index}`}
                className="border-border-light space-y-1 border-t pt-2"
              >
                <p>
                  {localize(topicLabels[finding.topic])} ·{' '}
                  {localize(`com_evolution_result_${finding.result}`)}
                  {finding.score !== undefined && ` · ${Math.round(finding.score * 100)}%`}
                </p>
                {finding.repository && (
                  <a
                    className="text-text-secondary text-sm underline"
                    href={finding.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {finding.repository}
                    {finding.commit ? ` · ${finding.commit.slice(0, 12)}` : ''}
                  </a>
                )}
                {finding.checks?.length ? (
                  <details>
                    <summary>{localize('com_evolution_checks')}</summary>
                    <ul className="list-inside list-disc text-sm">
                      {finding.checks.map((check) => (
                        <li key={check.id}>
                          {check.passed ? '✓' : '×'} {check.id}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {finding.artifactIds?.map((id) => (
                    <ArtifactDownload key={id} id={id} />
                  ))}
                </div>
              </div>
            ))}
          </article>
        ))}
      </section>
    </section>
  );
}
