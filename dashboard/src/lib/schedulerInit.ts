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

function registerJobs(_config: WeeklyScheduleConfig): void {
  // Auto-generation is deliberately DISABLED. Episodes are now hand-picked from the
  // /candidates board (see candidateCrawler + runCandidateCrawl). We no longer register
  // daily/weekly/robot pipeline cron jobs, regardless of the `weekly_schedule` setting.
  // `runPipeline` stays live for the manual /api/pipeline/start path (board → 做成一集).
  // ponytail: intentional no-op — do NOT re-enable auto-gen here.
  void slotsToCronJobs; // kept for reference; no longer wired to cron
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

  // Social trend scan — scrape Threads reply targets, then Telegram-notify. Frequency =
  // settings.trend_scrape_times (currently 1x/day + wide jitter). Plus a slot-based catch-up
  // every 30 min that backfills a slot the Mac slept through — at most ONE attempt per slot.
  registerTrendScanJobs();
  scheduler.register('社群熱點補跑檢查', '*/30 * * * *', trendCatchUp);

  // Threads voice corpus — daily incremental sync (new posts + refresh recent insights)
  scheduler.register('Threads 語料同步', '0 11 * * *', runVoiceSync);

  // Inspiration channel crawl — auto-pull new uploads from monitored channels + extract insights.
  // Schedule from settings (inspiration_crawl_schedule, default 07:00 daily); skip if disabled.
  const insp = getInspirationCrawlConfig();
  if (insp.enabled) {
    scheduler.register(INSPIRATION_CRAWL_JOB, insp.cron, runInspirationCrawl);
  }

  // Episode candidate crawl — daily metadata-only pull (queries + curated podcast channels)
  // that feeds the /candidates 選題板. This replaces daily auto-generation. 06:30 daily.
  scheduler.register(CANDIDATE_CRAWL_JOB, '30 6 * * *', runCandidateCrawl);

  // Robot-topic candidate crawl — feeds the same 選題板 (auto-tagged 機器人), queries only,
  // past-week window. Mon/Wed/Fri 07:00 so robot picks refresh a few times a week.
  scheduler.register(ROBOT_CANDIDATE_CRAWL_JOB, '0 7 * * 1,3,5', runRobotCandidateCrawl);

  // Resource curation — scrape AI/dev resources, gate on freshness, score, dedup,
  // draft, and record the top picks. Daily at 08:00.
  scheduler.register('資源策展掃描', '0 8 * * *', runResourceScanJob);

  // Thumbnail style auto-discovery — fires every Sunday 09:00 but only proceeds once
  // every ~2 weeks (node-cron has no biweekly syntax; the handler gates on a stored
  // last-run timestamp). Generates 10 new styles + sample previews for human review.
  scheduler.register('縮圖風格雙週生成', '0 9 * * 0', runThumbnailStyleBiweekly);

  // Old-audio cleanup — every Monday 04:00. Deletes local episode audio older
  // than the retention window, but only after verifying it exists on Drive.
  // Missing files are transparently restored on playback via /api/audio.
  scheduler.register('舊音檔清理', '0 4 * * 1', async () => {
    const { cleanupOldAudioFiles } = await import('@/services/audioRetention');
    await cleanupOldAudioFiles();
  });

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

const INSPIRATION_CRAWL_JOB = '靈感頻道爬取';

/** Read inspiration crawl config from settings: cron schedule + enabled flag. */
export function getInspirationCrawlConfig(): { cron: string; enabled: boolean } {
  let cron = '0 7 * * *'; // default: 07:00 daily (before the 08:00 morning curation)
  let enabled = true;
  try {
    const db = getDb();
    const c = db.prepare('SELECT value FROM settings WHERE key = ?').get('inspiration_crawl_schedule') as { value: string } | undefined;
    if (c?.value && c.value.trim().split(/\s+/).length === 5) cron = c.value.trim();
    const e = db.prepare('SELECT value FROM settings WHERE key = ?').get('inspiration_crawl_enabled') as { value: string } | undefined;
    if (e?.value != null) enabled = e.value !== '0' && e.value.toLowerCase() !== 'false';
  } catch { /* DB not ready — use defaults */ }
  return { cron, enabled };
}

/**
 * Apply the current inspiration-crawl settings to the live scheduler — used by the
 * settings toggle so changes take effect without a restart. Registers/updates/enables
 * the single job in place; never calls scheduler.start() (which would double-schedule
 * every other job). Throws on an invalid cron (caller maps to a 400).
 */
export function applyInspirationCrawlConfig(): { cron: string; enabled: boolean } {
  const scheduler = getScheduler();
  const cfg = getInspirationCrawlConfig();
  const name = INSPIRATION_CRAWL_JOB;
  if (!scheduler.getRegisteredNames().includes(name)) {
    scheduler.register(name, cfg.cron, runInspirationCrawl); // sets enabled=true, task=null
  }
  // updateSchedule (re)creates the cron task in place when enabled; disable stops it.
  if (cfg.enabled) { scheduler.enable(name); scheduler.updateSchedule(name, cfg.cron); }
  else { scheduler.disable(name); }
  log.info(cfg, 'Inspiration crawl config applied to scheduler');
  return cfg;
}

const CANDIDATE_CRAWL_JOB = '選題候選爬取';
const ROBOT_CANDIDATE_CRAWL_JOB = '機器人選題爬取';

async function runCandidateCrawl(): Promise<void> {
  log.info('Running episode candidate crawl...');
  try {
    const { crawlAll } = await import('@/services/candidateCrawler');
    const result = await crawlAll();
    log.info(result, 'Episode candidate crawl complete');
  } catch (err) {
    log.error({ err: (err as Error).message }, 'Episode candidate crawl failed');
  }
}

async function runRobotCandidateCrawl(): Promise<void> {
  log.info('Running robot candidate crawl...');
  try {
    const { crawlRobot } = await import('@/services/candidateCrawler');
    const result = await crawlRobot();
    log.info(result, 'Robot candidate crawl complete');
  } catch (err) {
    log.error({ err: (err as Error).message }, 'Robot candidate crawl failed');
  }
}

async function runInspirationCrawl(): Promise<void> {
  log.info('Running inspiration channel crawl...');
  try {
    const { crawlAllActive } = await import('@/services/inspiration/channelCrawler');
    const result = await crawlAllActive();
    log.info(result, 'Inspiration channel crawl complete');
  } catch (err) {
    log.error({ err: (err as Error).message }, 'Inspiration channel crawl failed');
  }
}

const THUMBNAIL_BIWEEKLY_LAST_RUN = 'thumbnail_biweekly_last_run';
const THUMBNAIL_BIWEEKLY_MIN_DAYS = 14;

/**
 * Biweekly thumbnail style discovery. Registered on a weekly Sunday cron but self-gates
 * to a 14-day cadence via the stored last-run timestamp, so it effectively runs every
 * other Sunday (and resumes correctly even if the Mac slept through a fire). Generates
 * 10 new styles + sample preview images, leaving them disabled for human review.
 */
async function runThumbnailStyleBiweekly(): Promise<void> {
  try {
    const db = getDb();
    const last = db.prepare('SELECT value FROM settings WHERE key = ?')
      .get(THUMBNAIL_BIWEEKLY_LAST_RUN) as { value: string } | undefined;
    if (last?.value) {
      const elapsedDays = (Date.now() - new Date(last.value).getTime()) / 86_400_000;
      if (elapsedDays < THUMBNAIL_BIWEEKLY_MIN_DAYS) {
        log.info({ elapsedDays: Math.round(elapsedDays) }, 'Thumbnail biweekly: <14 days since last run, skipping');
        return;
      }
    }

    log.info('Running biweekly thumbnail style discovery...');
    const { generateStyles, auditionStyle } = await import('@/services/thumbnailStyles');
    const styles = await generateStyles(10);

    // Pre-generate a sample image per style so they're ready to review on open.
    // Sequential to avoid hammering the image API; one failure doesn't abort the rest.
    let samples = 0;
    for (const s of styles) {
      try {
        await auditionStyle(s.id);
        samples++;
      } catch (err) {
        log.warn({ styleId: s.id, err: (err as Error).message }, 'Thumbnail biweekly: sample generation failed');
      }
    }

    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, datetime('now'), datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = datetime('now'), updated_at = datetime('now')
    `).run(THUMBNAIL_BIWEEKLY_LAST_RUN);

    log.info({ generated: styles.length, samples }, 'Biweekly thumbnail style discovery complete');
  } catch (err) {
    log.error({ err: (err as Error).message }, 'Biweekly thumbnail style discovery failed');
  }
}

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
    // Embed any new posts so the writer's retrieval stays current.
    const { backfillEmbeddings } = await import('@/services/voice/embeddings');
    await backfillEmbeddings();
    log.info(result, 'Threads voice sync complete');
  } catch (err) {
    log.error({ err: (err as Error).message }, 'Threads voice sync failed');
  }
}

async function runResourceScanJob(): Promise<void> {
  log.info('Running resource curation scan...');
  try {
    const { runResourceScan } = await import('@/services/resources/pipeline');
    const result = await runResourceScan({ trigger: 'cron' });
    log.info(result, 'Resource curation scan complete');
  } catch (err) {
    log.error({ err: (err as Error).message }, 'Resource curation scan failed');
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
  // Low volume by design (avoid looking like a scraper): see settings.trend_scrape_times.
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

/** Kill switch shared by every trend-scan trigger. settings.trend_scrape_enabled = '0'/'false'/'off'
 *  fully pauses the Threads crawler (e.g. while switching burner accounts). Default = enabled. */
function isTrendScrapeDisabled(): boolean {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('trend_scrape_enabled') as
      { value: string } | undefined;
    const v = (row?.value ?? '1').trim().toLowerCase();
    return v === '0' || v === 'false' || v === 'off';
  } catch { return false; }
}

/** Core trend scan + Telegram notify (no jitter). Used by both cron and catch-up.
 *  Guarded so cron + catch-up can never run two scans at once (also avoids the
 *  single Threads browser profile being launched twice → lock conflict). */
async function doTrendScan(trigger: string): Promise<void> {
  if (isTrendScrapeDisabled()) {
    log.info({ trigger }, 'Trend crawler disabled (settings.trend_scrape_enabled) — skipping scheduled/catch-up scan + notify');
    return;
  }
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

/** Jitter window (minutes) applied to the scheduled scan. Shared with the catch-up so it
 *  doesn't fire while a jittered run is still waiting. */
function getTrendJitterMinutes(): number {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('trend_jitter_minutes') as
      { value: string } | undefined;
    const n = row ? parseInt(row.value, 10) : NaN;
    if (Number.isFinite(n) && n >= 0 && n <= 120) return n;
  } catch { /* DB not ready */ }
  return 25;
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
 * Slot-based catch-up — guarantees a scan per configured slot even when the Mac sleeps
 * through the exact cron time. Runs every 30 min; only scans when a slot is overdue and
 * has had NO attempt yet today.
 *
 * "Attempt" = a row in `trend_scan_runs` (written even when the scrape FAILS), not a
 * scraped post. Keying off posts meant a failed/blocked run left the slot looking empty,
 * so the catch-up relaunched the browser every 30 min for the rest of the day — hammering
 * Meta with a broken session, which is exactly how a burner account gets flagged.
 * Overdue threshold also clears the jitter window, so it can't double-run with the cron.
 */
async function trendCatchUp(): Promise<void> {
  const db = getDb();
  const hours = getTrendHours();
  const morningH = hours[0] ?? 10;
  const eveningH = hours[hours.length - 1] ?? 21;
  const split = Math.min(16, Math.max(morningH + 1, Math.floor((morningH + eveningH) / 2)));
  const now = new Date();
  const nowH = now.getHours(); // local (system TZ)
  // Wait out the jitter window (+1h grace) before considering a slot missed.
  const graceH = Math.ceil((getTrendJitterMinutes() + 60) / 60);

  const slotHasScan = (from: number, to: number) =>
    db.prepare(
      `SELECT 1 FROM trend_scan_runs
       WHERE date(started_at, 'localtime') = date('now', 'localtime')
         AND CAST(strftime('%H', started_at, 'localtime') AS INTEGER) >= ?
         AND CAST(strftime('%H', started_at, 'localtime') AS INTEGER) < ? LIMIT 1`,
    ).get(from, to);

  // Morning slot overdue? (don't backfill the morning slot at night)
  if (morningH !== eveningH && nowH >= morningH + graceH && nowH < eveningH + graceH && !slotHasScan(0, split)) {
    log.info({ nowH }, 'Catch-up: morning trend scan missing, running now');
    await doTrendScan('catchup');
    return;
  }
  // Evening slot overdue?
  if (nowH >= eveningH + graceH && !slotHasScan(morningH === eveningH ? 0 : split, 24)) {
    log.info({ nowH }, 'Catch-up: evening trend scan missing, running now');
    await doTrendScan('catchup');
  }
}

/** Scheduled (cron) trend scan — randomised delay (jitter) so it doesn't fire on a fixed
 *  minute every day (a regular pattern is a bot tell). Window = `trend_jitter_minutes`
 *  (default 25). If the Mac idle-sleeps during a long jitter, the 30-min slot catch-up
 *  backfills that slot, so a wide jitter is safe. */
async function runTrendScan(): Promise<void> {
  const maxMin = getTrendJitterMinutes();
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

  // Inspiration crawl: if enabled and no active channel was crawled today, run it now.
  const insp = getInspirationCrawlConfig();
  if (insp.enabled) {
    const crawledToday = db.prepare(
      "SELECT 1 FROM channels WHERE active = 1 AND date(last_crawled_at, 'localtime') = date('now', 'localtime') LIMIT 1",
    ).get();
    if (!crawledToday) {
      log.info({ today }, 'Catch-up: inspiration crawl missing for today, running now');
      await runInspirationCrawl();
    }
  }

  // Candidate crawl: if nothing was crawled today, run it now (covers Mac-asleep-at-06:30).
  const candidateToday = db.prepare(
    "SELECT 1 FROM episode_candidates WHERE date(crawled_at, 'localtime') = date('now', 'localtime') LIMIT 1",
  ).get();
  if (!candidateToday) {
    log.info({ today }, 'Catch-up: candidate crawl missing for today, running now');
    await runCandidateCrawl();
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
