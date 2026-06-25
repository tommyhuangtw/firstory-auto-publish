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

  // Catch-up checks twice a day (13:00 + 21:00) — backfills the 09:00/10:00 syncs
  // if they were missed (e.g. the Mac was asleep at that time, so node-cron never fired).
  scheduler.register('數據補跑檢查（午）', '0 13 * * *', catchUpMissedSyncs);
  scheduler.register('數據補跑檢查（晚）', '0 21 * * *', catchUpMissedSyncs);

  // Social trend scan — scrape Threads hot posts, then Telegram-notify. 2x/day
  // (settings.trend_scrape_times). Plus a slot-based catch-up every 30 min that
  // guarantees a morning + evening scan even if the Mac slept through the cron times.
  registerTrendScanJobs();
  scheduler.register('社群熱點補跑檢查', '*/30 * * * *', trendCatchUp);

  // Threads voice corpus — daily incremental sync (new posts + refresh recent insights)
  scheduler.register('Threads 語料同步', '0 11 * * *', runVoiceSync);

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

async function runVoiceSync(): Promise<void> {
  try {
    const { isThreadsConnected } = await import('@/services/threads');
    if (!isThreadsConnected()) {
      log.info('Threads not connected, skipping voice sync');
      return;
    }
    log.info('Running Threads voice corpus sync...');
    const { syncThreadsPosts } = await import('@/services/voice/sync');
    const result = await syncThreadsPosts();
    log.info(result, 'Threads voice sync complete');
  } catch (err) {
    log.error({ err: (err as Error).message }, 'Threads voice sync failed');
  }
}

async function runSoundonSync(): Promise<void> {
  log.info('Running SoundOn analytics sync...');
  try {
    // Call in-process (NOT a self-fetch): the dev server runs HTTPS-only
    // (next dev --experimental-https), so a plain http:// fetch fails.
    const { syncSoundonAnalytics } = await import('@/services/soundonSync');
    const data = await syncSoundonAnalytics();
    log.info(data, 'SoundOn analytics sync complete');
  } catch (err) {
    log.error({ err: (err as Error).message }, 'SoundOn analytics sync failed');
  }
}

function registerTrendScanJobs(): void {
  const scheduler = getScheduler();
  // Low volume by design (avoid looking like a scraper): twice a day.
  let times = ['10:00', '21:00'];
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('trend_scrape_times') as
      { value: string } | undefined;
    if (row?.value) {
      const parsed = row.value.split(',').map((t) => t.trim()).filter((t) => /^\d{1,2}:\d{2}$/.test(t));
      if (parsed.length) times = parsed;
    }
  } catch { /* DB not ready — use defaults */ }

  for (const time of times) {
    const [hour, minute] = time.split(':');
    scheduler.register(`社群熱點掃描（${time}）`, `${minute} ${hour} * * *`, runTrendScan);
  }
}

let trendScanInFlight = false;

/** Core trend scan + Telegram notify (no jitter). Used by both cron and catch-up.
 *  Guarded so cron + catch-up can never run two scans at once (also avoids the
 *  single Threads browser profile being launched twice → lock conflict). */
async function doTrendScan(trigger: string): Promise<void> {
  if (trendScanInFlight) {
    log.info('Trend scan already running — skipping this trigger');
    return;
  }
  trendScanInFlight = true;
  log.info('Running social trend scan...');
  try {
    const { runTrendScan: scan } = await import('@/services/trends/pipeline');
    const result = await scan({ trigger });
    log.info(result, 'Trend scan complete');
    // Notify Tommy via Telegram after EVERY scan (scheduled or catch-up).
    const { sendHotPostsNote } = await import('@/services/trends/digest');
    await sendHotPostsNote();
  } catch (err) {
    log.error({ err: (err as Error).message }, 'Trend scan failed');
  } finally {
    trendScanInFlight = false;
  }
}

function getTrendHours(): number[] {
  let times = ['10:00', '21:00'];
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('trend_scrape_times') as
      { value: string } | undefined;
    if (row?.value) {
      const p = row.value.split(',').map((t) => t.trim()).filter((t) => /^\d{1,2}:\d{2}$/.test(t));
      if (p.length) times = p;
    }
  } catch { /* defaults */ }
  return times.map((t) => parseInt(t.split(':')[0], 10));
}

/**
 * Slot-based catch-up — guarantees a morning AND an evening scan each day even when
 * the Mac sleeps through the exact cron times. Runs frequently (every 30 min); only
 * actually scans when a slot is overdue (≥1h past its time) and hasn't run yet today.
 */
async function trendCatchUp(): Promise<void> {
  const db = getDb();
  const hours = getTrendHours();
  const morningH = hours[0] ?? 10;
  const eveningH = hours[hours.length - 1] ?? 21;
  const split = Math.min(16, Math.max(morningH + 1, Math.floor((morningH + eveningH) / 2)));
  const nowH = new Date().getHours(); // local (system TZ)

  const slotHasScan = (from: number, to: number) =>
    db.prepare(
      `SELECT 1 FROM trend_posts
       WHERE date(scraped_at, 'localtime') = date('now', 'localtime')
         AND CAST(strftime('%H', scraped_at, 'localtime') AS INTEGER) >= ?
         AND CAST(strftime('%H', scraped_at, 'localtime') AS INTEGER) < ? LIMIT 1`,
    ).get(from, to);

  // Morning slot overdue? (give the cron ~1h before backfilling; don't backfill morning at night)
  if (nowH >= morningH + 1 && nowH < eveningH + 1 && !slotHasScan(0, split)) {
    log.info({ nowH }, 'Catch-up: morning trend scan missing, running now');
    await doTrendScan('catchup');
    return;
  }
  // Evening slot overdue?
  if (nowH >= eveningH + 1 && !slotHasScan(split, 24)) {
    log.info({ nowH }, 'Catch-up: evening trend scan missing, running now');
    await doTrendScan('catchup');
  }
}

/** Scheduled (cron) trend scan — randomised delay (jitter) so it doesn't fire on a fixed
 *  minute every day (a regular pattern is a bot tell). Window = `trend_jitter_minutes`
 *  (default 25). If the Mac idle-sleeps during a long jitter, the 30-min slot catch-up
 *  backfills that slot, so a wide jitter is safe. */
async function runTrendScan(): Promise<void> {
  let maxMin = 25;
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('trend_jitter_minutes') as
      { value: string } | undefined;
    const n = row ? parseInt(row.value, 10) : NaN;
    if (Number.isFinite(n) && n >= 0 && n <= 120) maxMin = n;
  } catch { /* DB not ready — use default */ }
  const jitterMs = Math.floor(Math.random() * maxMin * 60_000);
  log.info({ jitterSec: Math.round(jitterMs / 1000), maxMin }, 'Social trend scan scheduled — waiting jitter');
  await new Promise((r) => setTimeout(r, jitterMs));
  await doTrendScan('scheduled');
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
/**
 * Backfill today's analytics syncs if they're missing — e.g. the Mac was asleep at
 * 09:00/10:00 so node-cron never fired. Idempotent (imports upsert), and only scrapes
 * when today's data is actually absent. Called on startup + twice a day (13:00, 21:00).
 */
async function catchUpMissedSyncs(): Promise<void> {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const hasSoundon = db.prepare(
    'SELECT 1 FROM soundon_daily_downloads WHERE date = ?'
  ).get(today);
  if (!hasSoundon) {
    log.info({ today }, 'Catch-up: SoundOn sync missing for today, running now');
    await runSoundonSync();
  }

  const hasYoutube = db.prepare(
    'SELECT 1 FROM youtube_channel_stats WHERE snapshot_date = ?'
  ).get(today);
  if (!hasYoutube) {
    log.info({ today }, 'Catch-up: YouTube sync missing for today, running now');
    await runYoutubeSync();
  }
}

function scheduleStartupCatchUp(): void {
  // 10s delay to let the server fully initialize before the first check.
  setTimeout(() => { void catchUpMissedSyncs(); }, 10_000);
  // Slightly later, backfill the trend scan slot if one is overdue (heavier — runs a browser).
  setTimeout(() => { void trendCatchUp(); }, 30_000);
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

    // No eligible source videos today → skip this episode entirely. Don't auto-retry
    // (retrying the same source batch will fail identically), just email a clear notice.
    if (errMsg.includes('NO_ELIGIBLE_VIDEOS')) {
      log.warn({ segmentType, episodeId }, 'No eligible source videos — skipping episode, no auto-retry');
      try {
        const gmail = getGmailService();
        await gmail.initialize();
        await gmail.sendPipelineNotification({
          episodeNumber: episodeId, segmentType, failedStage: null,
          errorMessage: errMsg, type: 'skipped',
        });
      } catch (emailErr) {
        log.error({ error: (emailErr as Error).message }, 'Failed to send skipped notification email');
      }
      return;
    }

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
