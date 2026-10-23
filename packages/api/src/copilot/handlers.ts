import { z } from 'zod';
import { Router } from 'express';
import { once } from 'node:events';
import { rateLimit } from 'express-rate-limit';
import type { AppConfig, EvolutionStore } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type { CopilotUser } from './policy';
import {
  canUseDots,
  threadPrefix,
  canUseCopilot,
  hasCopilotModel,
  resolveCopilotConfig,
  isDotRequestAllowed,
  isRuntimeRequestAllowed,
} from './policy';
import { startEvolutionScheduler } from '../evolution/scheduler';
import { createEvolutionService } from '../evolution/service';
import { createEvolutionRouter } from '../evolution/handlers';
import { registerShutdownTask } from '~/app/shutdown';
import { evolutionTools } from '../evolution/tools';
import { createCopilotHandler } from './runtime';

type CopilotRequest = Request & { config?: AppConfig };
const userSchema = z.object({
  id: z.string(),
  role: z.string().optional(),
  tenantId: z.string().optional(),
});
function userFor(req: Request): CopilotUser | undefined {
  const parsed = userSchema.safeParse(req.user);
  return parsed.success ? parsed.data : undefined;
}
type Dependencies = {
  resolveSecret: (value: string) => string | undefined;
  fetch?: typeof fetch;
  evolutionStore?: EvolutionStore;
  getAppConfig?: (options?: { baseOnly?: boolean }) => Promise<AppConfig>;
};

export function createCopilotRouter(deps: Dependencies): Router {
  const router = Router();
  const getDeploymentConfig = async () =>
    resolveCopilotConfig(
      (await deps.getAppConfig?.({ baseOnly: true }))?.config?.copilot,
      deps.resolveSecret,
    );
  const evolution =
    deps.evolutionStore && deps.getAppConfig
      ? createEvolutionService({ store: deps.evolutionStore, getConfig: getDeploymentConfig })
      : undefined;
  if (evolution)
    registerShutdownTask(
      'capability evolution',
      startEvolutionScheduler(
        evolution,
        async () => (await getDeploymentConfig())?.evolution?.pollIntervalMs ?? 60000,
      ),
      { phase: 'pre-drain' },
    );
  const configFor = (req: CopilotRequest) =>
    resolveCopilotConfig(req.config?.config?.copilot, deps.resolveSecret);
  const limiter = rateLimit({
    windowMs: 60_000,
    max: (req: CopilotRequest) => configFor(req)?.requestsPerMinute ?? 20,
    keyGenerator: (req: CopilotRequest) => threadPrefix(userFor(req)!),
    standardHeaders: true,
    legacyHeaders: false,
    message: { code: 'COPILOT_RATE_LIMITED' },
  });

  router.get('/status', (req: CopilotRequest, res) => {
    const config = configFor(req);
    const user = userFor(req);
    const enabled = canUseCopilot(config, user);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      enabled,
      ready: enabled && hasCopilotModel(config),
      generativeUI: enabled && config?.generativeUI === true,
      openDots: enabled && !!config && canUseDots(config, user!),
      evolution:
        enabled &&
        !!evolution &&
        config?.evolution?.enabled === true &&
        config.evolution.ownerUserId === user?.id &&
        config.evolution.tenantId === (user?.tenantId ?? ''),
      threadPrefix: user ? threadPrefix(user) : '',
    });
  });
  router.use((req: CopilotRequest, res, next) => {
    if (!canUseCopilot(configFor(req), userFor(req))) {
      res.status(403).json({ code: 'COPILOT_ACCESS_DENIED' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.use(limiter);
  if (evolution) router.use('/evolution', createEvolutionRouter(evolution));
  router.use('/runtime', async (req: CopilotRequest, res, next) => {
    const config = configFor(req)!;
    if (!hasCopilotModel(config)) {
      res.status(503).json({ code: 'COPILOT_SETUP_REQUIRED' });
      return;
    }
    if (
      Object.keys(req.query).length ||
      !isRuntimeRequestAllowed(req.method, req.path, req.body, userFor(req)!)
    ) {
      res.status(403).json({ code: 'COPILOT_SCOPE_DENIED' });
      return;
    }
    // The SDK Express router matches its complete base path, while Express has
    // stripped the mount path here. Its Fetch bridge also uses originalUrl.
    const mountedUrl = req.url;
    req.url = req.originalUrl;
    let context = '';
    try {
      context = (await evolution?.runtimeContext(userFor(req)!)) ?? '';
    } catch {
      req.url = mountedUrl;
      res.status(503).json({ code: 'EVOLUTION_CONTEXT_UNAVAILABLE' });
      return;
    }
    createCopilotHandler(
      config,
      req.baseUrl,
      evolution && context
        ? { context, tools: evolutionTools(evolution, userFor(req)!) }
        : undefined,
    )(req, res, (error) => {
      req.url = mountedUrl;
      next(error);
    });
  });
  router.use('/dots', async (req: CopilotRequest, res: Response & { flush?: () => void }) => {
    const config = configFor(req)!;
    if (!canUseDots(config, userFor(req)!)) {
      res.status(403).json({ code: 'OPENDOTS_ACCESS_DENIED' });
      return;
    }
    if (
      Object.keys(req.query).length ||
      /%|\\|\/\./.test(req.path) ||
      !isDotRequestAllowed(req.method, req.path)
    ) {
      res.status(403).json({ code: 'OPENDOTS_SCOPE_DENIED' });
      return;
    }
    const abort = new AbortController();
    const cancel = () => abort.abort();
    req.once('aborted', cancel);
    res.once('close', cancel);
    try {
      const target = new URL(config.openDots!.url);
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
        res.status(503).json({ code: 'OPENDOTS_SETUP_REQUIRED' });
        return;
      }
      target.pathname = `/api${req.path.replace(/^\/runtime(?=\/)/, '/copilotkit')}`;
      target.search = '';
      target.hash = '';
      const response = await (deps.fetch ?? fetch)(target, {
        method: req.method,
        headers: {
          authorization: `Bearer ${config.openDots!.token}`,
          'content-type': 'application/json',
          accept: req.path.startsWith('/runtime/')
            ? 'text/event-stream, application/json'
            : 'application/json',
        },
        body: req.method === 'POST' ? JSON.stringify(req.body) : undefined,
        redirect: 'error',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(config.timeoutMs)]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        res
          .status(response.status >= 500 ? 503 : response.status)
          .json({ code: 'OPENDOTS_REQUEST_FAILED' });
        return;
      }
      res.status(response.status);
      res.setHeader('Content-Type', response.headers.get('content-type') ?? 'application/json');
      res.setHeader('X-Accel-Buffering', 'no');
      const reader = response.body?.getReader();
      if (reader) {
        try {
          while (!abort.signal.aborted) {
            const chunk = await reader.read();
            if (chunk.done) break;
            if (!res.write(chunk.value)) await once(res, 'drain', { signal: abort.signal });
            res.flush?.();
          }
        } finally {
          reader.releaseLock();
        }
      }
      res.end();
    } catch {
      if (!res.headersSent && !res.destroyed)
        res.status(503).json({ code: 'OPENDOTS_UNAVAILABLE' });
      else res.end();
    } finally {
      req.off('aborted', cancel);
      res.off('close', cancel);
    }
  });
  return router;
}
