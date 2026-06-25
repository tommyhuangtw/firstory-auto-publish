/**
 * Threads Voice Corpus — sync service.
 *
 * Pulls the user's own Threads post history + per-post engagement into the
 * `threads_posts` table. One function handles both the initial backfill and
 * incremental refresh:
 *   - new posts            → metadata upserted, insights always fetched
 *   - posts never measured → insights fetched (insights_at IS NULL)
 *   - posts within refresh → insights refreshed (older posts' numbers are stable)
 *
 * See spec: docs/superpowers/specs/2026-06-25-threads-voice-corpus-design.md
 */

import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { fetchAllThreadsPosts, fetchPostInsights, type ThreadsInsights } from '@/services/threads';

const log = createChildLogger('voice:sync');

const DEFAULT_REFRESH_DAYS = 14;
const INSIGHTS_CONCURRENCY = 5;

export interface SyncResult {
  totalPosts: number;
  newPosts: number;
  insightsRefreshed: number;
  insightsFailed: number;
}

/** Engagement rate = total engagements / reach. views=0 falls back to raw sum. */
export function engagementRate(i: ThreadsInsights): number {
  const sum = i.likes + i.replies + i.reposts + i.quotes + i.shares;
  return sum / Math.max(i.views, 1);
}

/**
 * Sync Threads posts + insights into the DB.
 * @param refreshDays refresh insights for posts newer than this many days (default 14).
 *                    Posts never measured (insights_at NULL) are always (re)fetched.
 */
export async function syncThreadsPosts(refreshDays = DEFAULT_REFRESH_DAYS): Promise<SyncResult> {
  const db = getDb();
  const posts = await fetchAllThreadsPosts();
  log.info({ count: posts.length }, 'Syncing Threads posts');

  const cutoff = Date.now() - refreshDays * 86400000;
  let newPosts = 0;
  const needInsights: string[] = [];

  // Threads returns timestamps like "2026-06-25T12:17:13+0000"; SQLite's date()
  // can't parse the "+0000" offset. Normalise to ISO-with-Z so date()/datetime() work.
  const normalizeTs = (ts?: string): string | null => {
    if (!ts) return null;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toISOString();
  };

  const upsert = db.prepare(`
    INSERT INTO threads_posts (post_id, text, media_type, permalink, posted_at, is_repost, fetched_at)
    VALUES (@post_id, @text, @media_type, @permalink, @posted_at, @is_repost, datetime('now'))
    ON CONFLICT(post_id) DO UPDATE SET
      text = excluded.text,
      media_type = excluded.media_type,
      permalink = excluded.permalink,
      posted_at = excluded.posted_at,
      is_repost = excluded.is_repost,
      fetched_at = datetime('now')
  `);

  const wasNew = db.prepare('SELECT insights_at FROM threads_posts WHERE post_id = ?');

  for (const p of posts) {
    const existing = wasNew.get(p.id) as { insights_at: string | null } | undefined;
    if (!existing) newPosts++;

    upsert.run({
      post_id: p.id,
      text: p.text ?? '',
      media_type: p.media_type ?? null,
      permalink: p.permalink ?? null,
      posted_at: normalizeTs(p.timestamp),
      is_repost: p.media_type === 'REPOST_FACADE' ? 1 : 0,
    });

    const neverMeasured = !existing || existing.insights_at === null;
    const recent = p.timestamp ? new Date(p.timestamp).getTime() >= cutoff : false;
    if (neverMeasured || recent) needInsights.push(p.id);
  }

  // Fetch insights in small concurrent batches; failures are tolerated (retried next sync).
  let insightsRefreshed = 0;
  let insightsFailed = 0;
  const updateInsights = db.prepare(`
    UPDATE threads_posts SET
      views = @views, likes = @likes, replies = @replies, reposts = @reposts,
      quotes = @quotes, shares = @shares, engagement_rate = @engagement_rate,
      insights_at = datetime('now')
    WHERE post_id = @post_id
  `);

  for (let i = 0; i < needInsights.length; i += INSIGHTS_CONCURRENCY) {
    const chunk = needInsights.slice(i, i + INSIGHTS_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (id) => ({ id, insights: await fetchPostInsights(id) })),
    );
    for (const { id, insights } of results) {
      if (!insights) { insightsFailed++; continue; }
      updateInsights.run({
        post_id: id,
        ...insights,
        engagement_rate: engagementRate(insights),
      });
      insightsRefreshed++;
    }
  }

  const result: SyncResult = {
    totalPosts: posts.length,
    newPosts,
    insightsRefreshed,
    insightsFailed,
  };
  log.info(result, 'Threads sync complete');
  return result;
}
