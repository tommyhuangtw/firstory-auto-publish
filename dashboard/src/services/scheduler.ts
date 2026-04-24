import cron, { ScheduledTask } from 'node-cron';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('scheduler');

type JobHandler = () => Promise<void> | void;

interface ScheduledJob {
  name: string;
  schedule: string;
  handler: JobHandler;
  enabled: boolean;
  task: ScheduledTask | null;
  lastRun: Date | null;
  lastError: string | null;
}

/**
 * Centralized scheduler using node-cron.
 * Replaces n8n's schedule triggers.
 *
 * Usage:
 *   const scheduler = getScheduler();
 *   scheduler.register('daily-pipeline', '0 6 * * *', async () => { ... });
 *   scheduler.start();
 */
export class Scheduler {
  private jobs: Map<string, ScheduledJob> = new Map();

  register(name: string, schedule: string, handler: JobHandler): void {
    if (!cron.validate(schedule)) {
      throw new Error(`Invalid cron expression for "${name}": ${schedule}`);
    }

    this.jobs.set(name, {
      name,
      schedule,
      handler,
      enabled: true,
      task: null,
      lastRun: null,
      lastError: null,
    });

    log.info({ name, schedule }, 'Job registered');
  }

  start(): void {
    for (const [name, job] of this.jobs) {
      if (!job.enabled) continue;

      job.task = cron.schedule(job.schedule, async () => {
        log.info({ name }, 'Job triggered');
        try {
          await job.handler();
          job.lastRun = new Date();
          job.lastError = null;
          log.info({ name }, 'Job completed');
        } catch (error) {
          job.lastError = (error as Error).message;
          log.error({ name, error: job.lastError }, 'Job failed');
        }
      });

      log.info({ name, schedule: job.schedule }, 'Job started');
    }
  }

  stop(): void {
    for (const [name, job] of this.jobs) {
      if (job.task) {
        job.task.stop();
        job.task = null;
        log.info({ name }, 'Job stopped');
      }
    }
  }

  async triggerManually(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Job "${name}" not found`);

    log.info({ name }, 'Manual trigger');
    try {
      await job.handler();
      job.lastRun = new Date();
      job.lastError = null;
    } catch (error) {
      job.lastError = (error as Error).message;
      throw error;
    }
  }

  getStatus(): Array<{
    name: string;
    schedule: string;
    enabled: boolean;
    running: boolean;
    lastRun: string | null;
    lastError: string | null;
  }> {
    return Array.from(this.jobs.values()).map((job) => ({
      name: job.name,
      schedule: job.schedule,
      enabled: job.enabled,
      running: job.task !== null,
      lastRun: job.lastRun?.toISOString() ?? null,
      lastError: job.lastError,
    }));
  }
}

// Singleton
let _instance: Scheduler | null = null;
export function getScheduler(): Scheduler {
  if (!_instance) _instance = new Scheduler();
  return _instance;
}
