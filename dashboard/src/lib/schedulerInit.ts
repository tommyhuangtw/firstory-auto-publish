/**
 * Scheduler Initialization — registers podcast pipeline cron jobs.
 *
 * On startup, reads `weekly_schedule` from the settings table.
 * Falls back to hardcoded defaults if no DB config exists.
 *
 * Call `reloadScheduleFromDb()` after updating the DB config to
 * hot-reload cron jobs without a server restart.
 */

import { getScheduler } from '@/services/scheduler';
import { getDb } from '@/db';
import { startPipeline, retryFromStage } from '@/services/pipeline/graph';
import { getGmailService } from '@/services/gmail';
import { createChildLogger } from './logger';
import { emitEvent } from '@/services/notificationHub';
import type { SegmentType } from '@/services/pipeline/state';

const log = createChildLogger('scheduler-init');

// Tie init flag to globalThis so it stays in sync with the Scheduler singleton
const initKey = '__podcast_scheduler_initialized_v2__';
function isInitialized(): boolean {
  return !!(globalThis as Record<string, unknown>)[initKey];
}
function markInitialized(): void {
  (globalThis as Record<string, unknown>)[initKey] = true;
}

export interface ScheduleSlot {
  day: number;        // 0=Sun, 1=Mon, ..., 6=Sat (cron convention)
  segment: SegmentType;
  time: string;       // "HH:MM"
}

export interface WeeklyScheduleConfig {
  slots: ScheduleSlot[];
}

const DEFAULT_SCHEDULE: WeeklyScheduleConfig = {
  slots: [
    { day: 1, segment: 'daily', time: '11:00' },
    { day: 3, segment: 'daily', time: '11:00' },
    { day: 4, segment: 'robot', time: '11:00' },
    { day: 5, segment: 'daily', time: '11:00' },
    { day: 6, segment: 'daily', time: '11:00' },
    { day: 0, segment: 'weekly', time: '11:00' },
  ],
};

/** Read weekly_schedule from DB settings, or return default */
export function getScheduleConfig(): WeeklyScheduleConfig {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('weekly_schedule') as
      { value: string } | undefined;
    if (row) return JSON.parse(row.value) as WeeklyScheduleConfig;
  } catch {
    // DB not ready or parse error — use defaults
  }
  return DEFAULT_SCHEDULE;
}

/** Convert slots to cron jobs: group slots by segment, merge days */
function slotsToCronJobs(slots: ScheduleSlot[]): Array<{ name: string; cron: string; segment: SegmentType }> {
  // Group by segment+time → merge days
  const groups = new Map<string, { segment: SegmentType; time: string; days: number[] }>();
  for (const slot of slots) {
    const key = `${slot.segment}:${slot.time}`;
    const group = groups.get(key);
    if (group) {
      group.days.push(slot.day);
    } else {
      groups.set(key, { segment: slot.segment, time: slot.time, days: [slot.day] });
    }
  }

  const jobs: Array<{ name: string; cron: string; segment: SegmentType }> = [];
  const segmentCount = new Map<string, number>();

  for (const { segment, time, days } of groups.values()) {
    const [hour, minute] = time.split(':');
    const dayStr = days.sort().join(',');
    const cron = `${minute} ${hour} * * ${dayStr}`;

    // Name: use segment name, append index if multiple groups for same segment
    const count = (segmentCount.get(segment) ?? 0) + 1;
    segmentCount.set(segment, count);
    const name = count === 1 ? segment : `${segment}-${count}`;

    jobs.push({ name, cron, segment });
  }

  return jobs;
}

function registerJobs(config: WeeklyScheduleConfig): void {
  const scheduler = getScheduler();
  const cronJobs = slotsToCronJobs(config.slots);

  for (const { name, cron, segment } of cronJobs) {
    scheduler.register(name, cron, async () => {
      await runPipeline(segment);
    });
  }
}

export function initializeSchedulerJobs(): void {
  if (isInitialized()) return;
  markInitialized();

  const scheduler = getScheduler();
  const config = getScheduleConfig();

  registerJobs(config);

  // SoundOn analytics auto-sync — runs every day at 09:00
  scheduler.register('SoundOn 數據同步', '0 9 * * *', runSoundonSync);

  // YouTube analytics auto-sync — runs every day at 10:00
  scheduler.register('YouTube 數據同步', '0 10 * * *', runYoutubeSync);

  scheduler.start();
  log.info({ slots: config.slots.length }, 'Scheduler jobs registered and started');

  // Catch up any missed analytics syncs on startup
  scheduleStartupCatchUp();
}

/** Hot-reload: read DB config → stop all → re-register → start */
export function reloadScheduleFromDb(): void {
  const scheduler = getScheduler();

  // Stop and unregister all existing jobs
  const names = scheduler.getRegisteredNames();
  for (const name of names) {
    scheduler.unregister(name);
  }

  const config = getScheduleConfig();
  registerJobs(config);
  scheduler.start();
  log.info({ slots: config.slots.length }, 'Scheduler reloaded from DB config');
}

// ── Analytics sync handlers ──────────────────────────────────────────

async function runSoundonSync(): Promise<void> {
  log.info('Running SoundOn analytics sync...');
  try {
    const res = await fetch('http://localhost:3000/api/analytics/soundon-sync', {
      method: 'POST',
    });
    const data = await res.json() as { daily_imported?: number; episode_imported?: number; errors?: string[] };
    log.info(data, 'SoundOn analytics sync complete');
  } catch (err) {
    log.error({ err: (err as Error).message }, 'SoundOn analytics sync failed');
  }
}

async function runYoutubeSync(): Promise<void> {
  log.info('Running YouTube analytics sync...');
  try {
    const { syncYoutubeAnalytics } = await import('@/services/youtubeAnalytics');
    const result = await syncYoutubeAnalytics();
    log.info(result, 'YouTube analytics sync complete');
  } catch (err) {
    log.error({ err: (err as Error).message }, 'YouTube analytics sync failed');
  }
}

/** Check if today's analytics syncs have already run; if not, catch up */
function scheduleStartupCatchUp(): void {
  setTimeout(async () => {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    // Check SoundOn
    const hasSoundon = db.prepare(
      'SELECT 1 FROM soundon_daily_downloads WHERE date = ?'
    ).get(today);
    if (!hasSoundon) {
      log.info({ today }, 'Startup catch-up: SoundOn sync missing for today, running now');
      await runSoundonSync();
    }

    // Check YouTube
    const hasYoutube = db.prepare(
      'SELECT 1 FROM youtube_channel_stats WHERE snapshot_date = ?'
    ).get(today);
    if (!hasYoutube) {
      log.info({ today }, 'Startup catch-up: YouTube sync missing for today, running now');
      await runYoutubeSync();
    }
  }, 10_000); // 10s delay to let server fully initialize
}

// ── Pipeline runner ─────────────────────────────────────────────────

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
    await gmail.initialize();
    try {
      await gmail.sendPipelineNotification({
        episodeNumber: episodeId, segmentType, failedStage,
        errorMessage: errMsg, type: 'failure',
      });
    } catch (emailErr) {
      log.error({ error: (emailErr as Error).message }, 'Failed to send failure notification email');
    }

    // 2. Auto retry once from the failed stage (after cooldown)
    if (failedStage) {
      log.info({ segmentType, episodeId, failedStage }, 'Auto-retrying pipeline from failed stage in 60s');
      await new Promise((r) => setTimeout(r, 60_000));
      log.info({ segmentType, episodeId, failedStage }, 'Auto-retrying pipeline from failed stage');
      try {
        await retryFromStage(pipelineRunId, failedStage);

        // 3a. Retry succeeded — send success email + webhook
        try {
          await gmail.sendPipelineNotification({
            episodeNumber: episodeId, segmentType, failedStage,
            errorMessage: errMsg, type: 'retry_success',
          });
        } catch (emailErr) {
          log.error({ error: (emailErr as Error).message }, 'Failed to send retry success email');
        }
        emitEvent({
          type: 'pipeline.retry.success',
          episodeId, segmentType, stage: failedStage,
          error: errMsg,
          timestamp: new Date().toISOString(),
        }).catch(() => {});
      } catch (retryError) {
        const retryErrMsg = (retryError as Error).message;
        log.error({ segmentType, episodeId, error: retryErrMsg }, 'Auto-retry also failed');

        // 3b. Retry failed — send retry-failure email + webhook
        try {
          await gmail.sendPipelineNotification({
            episodeNumber: episodeId, segmentType, failedStage,
            errorMessage: errMsg, type: 'retry_failure', retryError: retryErrMsg,
          });
        } catch (emailErr) {
          log.error({ error: (emailErr as Error).message }, 'Failed to send retry failure email');
        }
        emitEvent({
          type: 'pipeline.retry.failed',
          episodeId, segmentType, stage: failedStage,
          error: errMsg, retryError: retryErrMsg,
          timestamp: new Date().toISOString(),
        }).catch(() => {});
      }
    }
  });
}
