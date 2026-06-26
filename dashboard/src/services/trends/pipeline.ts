/**
 * Trend scan orchestrator (For You feed model) — CRAWL ONLY.
 *
 * Scrapes the "為你推薦" feed + configured seed topics → keeps only RECENT posts
 * with enough traction (讚+留言 ≥ floor; lower floor for AI) → records EVERY fresh
 * post, AI-relevant first. Drafts are NOT written here — Tommy generates them
 * on-demand per post (optionally adding his own opinion) from the /trends page.
 */

import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { runScrape } from './crawler';
import { engagementVelocity, isAIRelevant } from './scorer';
import { embedTexts } from './embeddings';
import { sendTrendAlert } from './digest';
import type { TrendScanResult, RawThreadPost } from './types';

const log = createChildLogger('trend-pipeline');

function getSetting(key: string, fallback: string): string {
  const db = getDb();
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? fallback;
}

export async function runTrendScan(opts: { maxPosts?: number; trigger?: string } = {}): Promise<TrendScanResult> {
  const db = getDb();
  const recencyDays = parseInt(getSetting('trend_recency_days', '2'), 10);
  const minEngagement = parseInt(getSetting('trend_min_engagement', '80'), 10);
  // Reply-zone (niche) gate is independent of the main floor: likes >= 30 + recent.
  const nicheMinLikes = parseInt(getSetting('trend_niche_min_likes', '30'), 10);
  const nicheRecencyDays = parseInt(getSetting('trend_niche_recency_days', '2'), 10);

  // Open an audit-log row immediately so even a failed scrape is recorded.
  const t0 = Date.now();
  const runId = Number(db.prepare(
    'INSERT INTO trend_scan_runs (started_at, trigger) VALUES (?, ?)',
  ).run(new Date().toISOString(), opts.trigger ?? null).lastInsertRowid);
  const finishRun = (fields: Record<string, unknown>) => {
    const keys = Object.keys(fields);
    db.prepare(
      `UPDATE trend_scan_runs SET finished_at = ?, duration_ms = ?, ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    ).run(new Date().toISOString(), Date.now() - t0, ...keys.map((k) => fields[k]), runId);
    db.prepare('DELETE FROM trend_scan_runs WHERE id NOT IN (SELECT id FROM trend_scan_runs ORDER BY id DESC LIMIT 60)').run();
  };

  let feed: RawThreadPost[];
  let topics: string[];
  try {
    ({ posts: feed, topics } = await runScrape({ maxPosts: opts.maxPosts ?? 40 }));
  } catch (err) {
    const msg = (err as Error).message;
    log.error({ err: msg }, 'Threads scrape failed');
    finishRun({ error: msg });
    await sendTrendAlert(`Threads 爬取失敗，本次掃描中止：${msg}`);
    throw err;
  }

  const result: TrendScanResult = {
    postsRecorded: 0, draftsCreated: 0, skipped: 0,
    scraped: feed.length, belowFloor: 0, stale: 0, deduped: 0,
  };

  // Record every dropped post + WHY, so the whole funnel is auditable (capped to bound JSON).
  const dropped: Array<{ a: string | null; t: string; e: number; r: string; p: string | null }> = [];
  const drop = (p: RawThreadPost, reason: string) => {
    if (dropped.length < 300) dropped.push({ a: p.author ?? null, t: p.text.slice(0, 80), e: p.likeCount + p.replyCount, r: reason, p: p.permalink ?? null });
  };

  // HARD GATE: 讚+留言 must clear the engagement floor (flat — applies to AI too) AND be
  // recent. Posts that fail here are dropped BEFORE embedding — we never spend an embedding
  // call on a post we won't display.
  const cutoff = Date.now() - recencyDays * 86_400_000;
  const nicheCutoff = Date.now() - nicheRecencyDays * 86_400_000;
  const recent = feed.filter((p) => {
    if (p.niche) {
      // Reply-zone gate: likes >= 30 + recent, independent of the main 80 floor.
      if (p.likeCount < nicheMinLikes) { result.belowFloor++; drop(p, 'niche_below_likes'); return false; }
      if (p.timestamp && new Date(p.timestamp).getTime() < nicheCutoff) { result.stale++; drop(p, 'niche_stale'); return false; }
      return true;
    }
    if (p.likeCount + p.replyCount < minEngagement) { result.belowFloor++; drop(p, 'below_floor'); return false; }
    if (p.timestamp && new Date(p.timestamp).getTime() < cutoff) { result.stale++; drop(p, 'stale'); return false; }
    return true;
  });

  // Dedup vs already-recorded permalinks so the same post isn't recorded twice.
  const seenRows = db.prepare(
    `SELECT permalink FROM trend_posts WHERE permalink IS NOT NULL AND scraped_at > datetime('now', ?)`,
  ).all(`-${recencyDays + 1} days`) as { permalink: string }[];
  const seen = new Set(seenRows.map((r) => r.permalink));
  const fresh = recent.filter((p) => {
    if (p.permalink && seen.has(p.permalink)) { drop(p, 'duplicate'); return false; }
    return true;
  });
  result.deduped = recent.length - fresh.length;

  // Rank: AI/tech-relevant first (Tommy's core content), then by engagement velocity.
  const ranked = fresh
    .map((p) => ({ p, v: engagementVelocity(p), rel: isAIRelevant(p.text, p.source) }))
    .sort((a, b) => (b.rel ? 1 : 0) - (a.rel ? 1 : 0) || b.v - a.v);

  // Embed all posts in one batch (for the 👍 interest-similarity loop); null-safe.
  const vecs = await embedTexts(ranked.map((r) => r.p.text));

  // Record every fresh post — this IS the deliverable (hot posts to reply to / draft from).
  const insertPost = db.prepare(`
    INSERT INTO trend_posts (topic_id, topic, source, author, text, like_count, reply_count, velocity, posted_at, permalink, relevant, embedding, scan_run_id, niche)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  ranked.forEach(({ p, v, rel }, i) => {
    insertPost.run(
      null, null, p.source ?? null, p.author ?? null, p.text, p.likeCount, p.replyCount,
      Math.round(v), p.timestamp ?? null, p.permalink ?? null, rel ? 1 : 0,
      vecs[i] ? JSON.stringify(vecs[i]) : null, runId, p.niche ? 1 : 0,
    );
    result.postsRecorded++;
  });

  finishRun({
    topics: JSON.stringify(topics), scraped: result.scraped, below_floor: result.belowFloor,
    stale: result.stale, deduped: result.deduped, recorded: result.postsRecorded,
    dropped: JSON.stringify(dropped),
  });

  log.info(
    { runId, scraped: result.scraped, belowFloor: result.belowFloor, stale: result.stale,
      deduped: result.deduped, recorded: result.postsRecorded },
    'Trend scan complete (posts only — drafts are on-demand)',
  );
  return result;
}
