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
  skipNextRun: boolean;
  paused: boolean;
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
      skipNextRun: false,
      paused: false,
    });

    log.info({ name, schedule }, 'Job registered');
  }

  start(): void {
    for (const [name, job] of this.jobs) {
      if (!job.enabled) continue;

      job.task = cron.schedule(job.schedule, async () => {
        if (job.paused) {
          log.info({ name }, 'Job skipped (paused)');
          return;
        }
        if (job.skipNextRun) {
          job.skipNextRun = false;
          log.info({ name }, 'Job skipped (skip-next), auto-cleared');
          return;
        }
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

  enable(name: string): void {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Job "${name}" not found`);
    if (job.enabled) return;
    job.enabled = true;
    job.task = cron.schedule(job.schedule, async () => {
      if (job.paused) return;
      if (job.skipNextRun) {
        job.skipNextRun = false;
        log.info({ name }, 'Job skipped (skip-next), auto-cleared');
        return;
      }
      log.info({ name }, 'Job triggered');
      try {
        await job.handler();
        job.lastRun = new Date();
        job.lastError = null;
      } catch (error) {
        job.lastError = (error as Error).message;
        log.error({ name, error: job.lastError }, 'Job failed');
      }
    });
    log.info({ name }, 'Job enabled');
  }

  disable(name: string): void {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Job "${name}" not found`);
    job.enabled = false;
    if (job.task) {
      job.task.stop();
      job.task = null;
    }
    log.info({ name }, 'Job disabled');
  }

  skipNext(name: string): void {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Job "${name}" not found`);
    job.skipNextRun = true;
    log.info({ name }, 'Job will skip next run');
  }

  unskip(name: string): void {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Job "${name}" not found`);
    job.skipNextRun = false;
    log.info({ name }, 'Job unskipped');
  }

  pause(name: string): void {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Job "${name}" not found`);
    job.paused = true;
    log.info({ name }, 'Job paused indefinitely');
  }

  resume(name: string): void {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Job "${name}" not found`);
    job.paused = false;
    log.info({ name }, 'Job resumed');
  }

  updateSchedule(name: string, newSchedule: string): void {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Job "${name}" not found`);
    if (!cron.validate(newSchedule)) {
      throw new Error(`Invalid cron expression: ${newSchedule}`);
    }

    // Stop existing task
    if (job.task) {
      job.task.stop();
      job.task = null;
    }

    job.schedule = newSchedule;

    // Restart if enabled
    if (job.enabled) {
      job.task = cron.schedule(job.schedule, async () => {
        if (job.paused) return;
        if (job.skipNextRun) {
          job.skipNextRun = false;
          log.info({ name }, 'Job skipped (skip-next), auto-cleared');
          return;
        }
        log.info({ name }, 'Job triggered');
        try {
          await job.handler();
          job.lastRun = new Date();
          job.lastError = null;
        } catch (error) {
          job.lastError = (error as Error).message;
          log.error({ name, error: job.lastError }, 'Job failed');
        }
      });
    }

    log.info({ name, schedule: newSchedule }, 'Job schedule updated');
  }

  unregister(name: string): void {
    const job = this.jobs.get(name);
    if (!job) return;
    if (job.task) {
      job.task.stop();
      job.task = null;
    }
    this.jobs.delete(name);
    log.info({ name }, 'Job unregistered');
  }

  getRegisteredNames(): string[] {
    return Array.from(this.jobs.keys());
  }

  getStatus(): Array<{
    name: string;
    schedule: string;
    enabled: boolean;
    running: boolean;
    lastRun: string | null;
    lastError: string | null;
    skipNextRun: boolean;
    paused: boolean;
  }> {
    return Array.from(this.jobs.values()).map((job) => ({
      name: job.name,
      schedule: job.schedule,
      enabled: job.enabled,
      running: job.task !== null,
      lastRun: job.lastRun?.toISOString() ?? null,
      lastError: job.lastError,
      skipNextRun: job.skipNextRun,
      paused: job.paused,
    }));
  }
}

// Singleton — use globalThis to survive Next.js module reloads
// Bump version when Scheduler interface changes to force re-creation
const globalKey = '__podcast_scheduler_v2__';
export function getScheduler(): Scheduler {
  const g = globalThis as Record<string, unknown>;
  if (!g[globalKey]) g[globalKey] = new Scheduler();
  return g[globalKey] as Scheduler;
}
