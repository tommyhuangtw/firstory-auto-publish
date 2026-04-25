/**
 * Scheduler Initialization — registers 3 podcast pipeline cron jobs.
 *
 * Jobs:
 * - robot-weekly:  Thu 11am  (機器人觀察週報)
 * - weekly-report: Sun 11am  (AI精選週報)
 * - daily-report:  Mon/Wed/Fri/Sat 11am  (AI懶人報)
 *
 * Import this module at server startup to register all jobs.
 */

import { getScheduler } from '@/services/scheduler';
import { getDb } from '@/db';
import { startPipeline } from '@/services/pipeline/graph';
import { createChildLogger } from './logger';
import type { SegmentType } from '@/services/pipeline/state';

const log = createChildLogger('scheduler-init');

let initialized = false;

export function initializeSchedulerJobs(): void {
  if (initialized) return;
  initialized = true;

  const scheduler = getScheduler();

  // Robot weekly — Thursday 11am
  scheduler.register('robot-weekly', '0 11 * * 4', async () => {
    await runPipeline('robot');
  });

  // Weekly report — Sunday 11am
  scheduler.register('weekly-report', '0 11 * * 0', async () => {
    await runPipeline('weekly');
  });

  // Daily report — Mon, Wed, Fri, Sat 11am
  scheduler.register('daily-report', '0 11 * * 1,3,5,6', async () => {
    await runPipeline('daily');
  });

  scheduler.start();
  log.info('Scheduler jobs registered and started');
}

async function runPipeline(segmentType: SegmentType): Promise<void> {
  const db = getDb();

  // Find next episode number
  const latest = db.prepare(
    'SELECT MAX(episode_number) as max_ep FROM episodes WHERE segment_type = ?'
  ).get(segmentType) as { max_ep: number | null } | undefined;

  const nextEp = (latest?.max_ep || 0) + 1;

  log.info({ segmentType, episodeNumber: nextEp }, 'Scheduler triggering pipeline');

  // Create pipeline run and episode records
  const result = db.prepare(
    `INSERT INTO pipeline_runs (episode_number, segment_type, status, current_stage)
     VALUES (?, ?, 'running', 'fetchYoutube')`
  ).run(nextEp, segmentType);
  const pipelineRunId = Number(result.lastInsertRowid);

  db.prepare(
    `INSERT OR IGNORE INTO episodes (episode_number, segment_type, status)
     VALUES (?, ?, 'generating')`
  ).run(nextEp, segmentType);

  // Fire and forget
  startPipeline(nextEp, segmentType, pipelineRunId).catch((error) => {
    log.error({ segmentType, episodeNumber: nextEp, error: (error as Error).message }, 'Scheduled pipeline failed');
  });
}
