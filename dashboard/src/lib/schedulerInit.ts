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
import { startPipeline, retryFromStage } from '@/services/pipeline/graph';
import { getGmailService } from '@/services/gmail';
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

  // Guard: prevent duplicate runs on the same day for the same segment type
  const today = new Date().toISOString().slice(0, 10);
  const existing = db.prepare(
    `SELECT id FROM pipeline_runs
     WHERE segment_type = ? AND date(started_at) = ? AND status IN ('running', 'completed')`
  ).get(segmentType, today) as { id: number } | undefined;

  if (existing) {
    log.warn({ segmentType, today, existingRunId: existing.id }, 'Pipeline already ran today — skipping');
    return;
  }

  // Create episode (no episode_number — assigned at publish time)
  const epResult = db.prepare(
    `INSERT INTO episodes (segment_type, status) VALUES (?, 'generating')`
  ).run(segmentType);
  const episodeId = Number(epResult.lastInsertRowid);

  // Create pipeline run with episode_id
  const result = db.prepare(
    `INSERT INTO pipeline_runs (episode_id, segment_type, status, current_stage)
     VALUES (?, ?, 'running', 'fetchYoutube')`
  ).run(episodeId, segmentType);
  const pipelineRunId = Number(result.lastInsertRowid);

  log.info({ segmentType, episodeId, pipelineRunId }, 'Scheduler triggering pipeline');

  // Fire and forget — with auto-retry and email notifications
  startPipeline(episodeId, segmentType, pipelineRunId).catch(async (error) => {
    const errMsg = (error as Error).message;
    log.error({ segmentType, episodeId, error: errMsg }, 'Scheduled pipeline failed');

    // Get failed stage from DB
    const failedRun = db.prepare(
      'SELECT current_stage FROM pipeline_runs WHERE id = ?'
    ).get(pipelineRunId) as { current_stage: string | null } | undefined;
    const failedStage = failedRun?.current_stage || null;

    // 1. Send failure notification email
    const gmail = getGmailService();
    try {
      await gmail.sendPipelineNotification({
        episodeNumber: episodeId, segmentType, failedStage,
        errorMessage: errMsg, type: 'failure',
      });
    } catch (emailErr) {
      log.error({ error: (emailErr as Error).message }, 'Failed to send failure notification email');
    }

    // 2. Auto retry once from the failed stage
    if (failedStage) {
      log.info({ segmentType, episodeId, failedStage }, 'Auto-retrying pipeline from failed stage');
      try {
        await retryFromStage(pipelineRunId, failedStage);

        // 3a. Retry succeeded — send success email
        try {
          await gmail.sendPipelineNotification({
            episodeNumber: episodeId, segmentType, failedStage,
            errorMessage: errMsg, type: 'retry_success',
          });
        } catch (emailErr) {
          log.error({ error: (emailErr as Error).message }, 'Failed to send retry success email');
        }
      } catch (retryError) {
        const retryErrMsg = (retryError as Error).message;
        log.error({ segmentType, episodeId, error: retryErrMsg }, 'Auto-retry also failed');

        // 3b. Retry failed — send retry-failure email
        try {
          await gmail.sendPipelineNotification({
            episodeNumber: episodeId, segmentType, failedStage,
            errorMessage: errMsg, type: 'retry_failure', retryError: retryErrMsg,
          });
        } catch (emailErr) {
          log.error({ error: (emailErr as Error).message }, 'Failed to send retry failure email');
        }
      }
    }
  });
}
