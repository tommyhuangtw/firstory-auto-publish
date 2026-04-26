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

const PODCAST_ID = 'ca974d36-6fcc-46fc-a339-ba7ed8902c80';
const RSS_URL = `https://feeds.soundon.fm/podcasts/${PODCAST_ID}.xml`;

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

  // Determine next episode number from RSS feed (all segment types share the same podcast feed)
  let nextEp: number;
  try {
    const res = await fetch(RSS_URL);
    if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
    const xml = await res.text();
    const epMatch = xml.match(/<item>[\s\S]*?<title><!\[CDATA\[.*?EP\s*(\d+)/i);
    const latestRssEp = epMatch ? parseInt(epMatch[1]) : null;

    if (latestRssEp) {
      nextEp = latestRssEp + 1;
      log.info({ segmentType, latestRssEp, nextEp }, 'Episode number from RSS feed');
    } else {
      // RSS parsed but no EP number found — fallback to DB max across all segment types
      const latest = db.prepare(
        'SELECT MAX(episode_number) as max_ep FROM episodes'
      ).get() as { max_ep: number | null } | undefined;
      nextEp = (latest?.max_ep || 0) + 1;
      log.warn({ segmentType, nextEp }, 'No EP number in RSS — using DB fallback');
    }
  } catch (error) {
    // RSS fetch failed entirely — fallback to DB
    const latest = db.prepare(
      'SELECT MAX(episode_number) as max_ep FROM episodes'
    ).get() as { max_ep: number | null } | undefined;
    nextEp = (latest?.max_ep || 0) + 1;
    log.warn({ segmentType, nextEp, error: (error as Error).message }, 'RSS fetch failed — using DB fallback');
  }

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
