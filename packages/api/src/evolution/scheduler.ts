import { logger } from '@librechat/data-schemas';
import type { EvolutionService } from './service';
import { safeEvolutionCode } from './service';

export function startEvolutionScheduler(
  service: EvolutionService,
  getInterval: () => Promise<number>,
) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = async () => {
    if (stopped) return;
    let interval = 60000;
    try {
      interval = await getInterval();
      if (stopped) return;
      await service.tick();
    } catch (error) {
      logger.warn('[Evolution] Background cycle failed', { code: safeEvolutionCode(error) });
    }
    if (!stopped) {
      timer = setTimeout(() => {
        void tick();
      }, interval);
      timer.unref();
    }
  };
  timer = setTimeout(() => {
    void tick();
  }, 1000);
  timer.unref();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await service.stop();
  };
}
