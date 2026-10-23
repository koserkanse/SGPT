import { z } from 'zod';
import { Router } from 'express';
import { evolutionTopicSchema } from 'librechat-data-provider';
import type { Request, Response, NextFunction } from 'express';
import type { EvolutionService } from './service';
import { safeEvolutionCode } from './service';

const actorSchema = z.object({
  id: z.string(),
  role: z.string().optional(),
  tenantId: z.string().optional(),
});
const topicInput = z.object({ topic: evolutionTopicSchema }).strict();
const lessonInput = topicInput
  .extend({ text: z.string().trim().min(3).max(1000), supersedes: z.string().uuid().optional() })
  .strict();
const pauseInput = z.object({ paused: z.boolean() }).strict();
const errorStatus = (code: string) => {
  if (code === 'EVOLUTION_ACCESS_DENIED') return 403;
  if (
    ['EVOLUTION_BUSY', 'EVOLUTION_CONFLICT', 'EVOLUTION_PAUSED', 'NO_ACTIVE_VERSION'].includes(code)
  )
    return 409;
  if (['INVALID_LESSON_REFERENCE', 'INVALID_TOPIC', 'INVALID_INPUT'].includes(code)) return 400;
  return 503;
};

export function createEvolutionRouter(service: EvolutionService): Router {
  const router = Router();
  const handle =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, _next: NextFunction) => {
      void fn(req, res).catch((error) => {
        const code = safeEvolutionCode(error);
        if (!res.headersSent) res.status(errorStatus(code)).json({ code });
      });
    };
  router.get(
    '/',
    handle(async (req, res) => {
      res.json(await service.status(actorSchema.parse(req.user)));
    }),
  );
  router.post(
    '/run',
    handle(async (req, res) => {
      res.status(202).json(await service.start('manual', actorSchema.parse(req.user)));
    }),
  );
  router.post(
    '/cancel',
    handle(async (req, res) => {
      await service.cancel(actorSchema.parse(req.user));
      res.json({ ok: true });
    }),
  );
  router.post(
    '/pause',
    handle(async (req, res) => {
      const parsed = pauseInput.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: 'INVALID_INPUT' });
        return;
      }
      await service.mutate(actorSchema.parse(req.user), (state) => {
        state.paused = parsed.data.paused;
      });
      res.json({ ok: true });
    }),
  );
  router.post(
    '/rollback',
    handle(async (req, res) => {
      const parsed = topicInput.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: 'INVALID_INPUT' });
        return;
      }
      await service.rollback(actorSchema.parse(req.user), parsed.data.topic);
      res.json({ ok: true });
    }),
  );
  router.post(
    '/lessons',
    handle(async (req, res) => {
      const parsed = lessonInput.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: 'INVALID_INPUT' });
        return;
      }
      await service.learn(actorSchema.parse(req.user), parsed.data);
      res.json({ ok: true });
    }),
  );
  router.get(
    '/artifacts/:id',
    handle(async (req, res) => {
      if (!z.string().uuid().safeParse(req.params.id).success) {
        res.status(404).json({ code: 'ARTIFACT_NOT_FOUND' });
        return;
      }
      const artifact = await service.artifact(actorSchema.parse(req.user), req.params.id);
      if (!artifact) {
        res.status(404).json({ code: 'ARTIFACT_NOT_FOUND' });
        return;
      }
      res.setHeader('Content-Type', artifact.mime);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${artifact.name.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(Buffer.from(artifact.data, 'base64'));
    }),
  );
  return router;
}
