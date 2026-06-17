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

export async function runTrendScan(opts: { maxPosts?: number } = {}): Promise<TrendScanResult> {
  const db = getDb();
  const recencyDays = parseInt(getSetting('trend_recency_days', '2'), 10);
  const minEngagement = parseInt(getSetting('trend_min_engagement', '80'), 10);
  const minEngagementAI = parseInt(getSetting('trend_min_engagement_ai', '30'), 10);

  let feed: RawThreadPost[];
  try {
    feed = await runScrape({ maxPosts: opts.maxPosts ?? 40 });
  } catch (err) {
    const msg = (err as Error).message;
    log.error({ err: msg }, 'Threads scrape failed');
    await sendTrendAlert(`Threads 爬取失敗，本次掃描中止：${msg}`);
    throw err;
  }

  const result: TrendScanResult = { postsRecorded: 0, draftsCreated: 0, skipped: 0 };

  // Keep only posts with traction (AI gets a lower floor) AND that are recent.
  const cutoff = Date.now() - recencyDays * 86_400_000;
  const recent = feed.filter((p) => {
    const eng = p.likeCount + p.replyCount;
    const floor = isAIRelevant(p.text, p.source) ? minEngagementAI : minEngagement;
    return eng >= floor && (!p.timestamp || new Date(p.timestamp).getTime() >= cutoff);
  });

  // Dedup vs already-recorded permalinks so the same post isn't recorded twice.
  const seenRows = db.prepare(
    `SELECT permalink FROM trend_posts WHERE permalink IS NOT NULL AND scraped_at > datetime('now', ?)`,
  ).all(`-${recencyDays + 1} days`) as { permalink: string }[];
  const seen = new Set(seenRows.map((r) => r.permalink));
  const fresh = recent.filter((p) => !p.permalink || !seen.has(p.permalink));

  // Rank: AI/tech-relevant first (Tommy's core content), then by engagement velocity.
  const ranked = fresh
    .map((p) => ({ p, v: engagementVelocity(p), rel: isAIRelevant(p.text, p.source) }))
    .sort((a, b) => (b.rel ? 1 : 0) - (a.rel ? 1 : 0) || b.v - a.v);

  // Embed all posts in one batch (for the 👍 interest-similarity loop); null-safe.
  const vecs = await embedTexts(ranked.map((r) => r.p.text));

  // Record every fresh post — this IS the deliverable (hot posts to reply to / draft from).
  const insertPost = db.prepare(`
    INSERT INTO trend_posts (topic_id, topic, source, author, text, like_count, reply_count, velocity, posted_at, permalink, relevant, embedding)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  ranked.forEach(({ p, v, rel }, i) => {
    insertPost.run(
      null, null, p.source ?? null, p.author ?? null, p.text, p.likeCount, p.replyCount,
      Math.round(v), p.timestamp ?? null, p.permalink ?? null, rel ? 1 : 0,
      vecs[i] ? JSON.stringify(vecs[i]) : null,
    );
    result.postsRecorded++;
  });

  log.info(
    { scraped: feed.length, recent: recent.length, fresh: fresh.length, recorded: result.postsRecorded },
    'Trend scan complete (posts only — drafts are on-demand)',
  );
  return result;
}
