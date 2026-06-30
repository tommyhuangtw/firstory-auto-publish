import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { interestScore, parseEmbedding } from '@/services/trends/embeddings';

/**
 * List scraped posts. Each post gets an `interest_score` = contrastive similarity to the
 * 👍/👎 profile (see embeddings.ts). When a profile exists, the default is a HARD FILTER:
 * only posts with score ≥ `trend_min_interest` are returned, ranked by interest — i.e.
 * "only show what I'm interested in". ?all=1 disables the filter (see everything);
 * ?minScore overrides the threshold. Unscored posts (no embedding yet) fail OPEN — shown,
 * not hidden, since we can't judge them. Other filters: ?topic_id, ?days, ?limit, ?includeDisliked.
 */
export async function GET(request: NextRequest) {
  const db = getDb();
  const { searchParams } = request.nextUrl;
  const topicId = searchParams.get('topic_id');
  const days = parseInt(searchParams.get('days') || '7', 10);
  const limit = parseInt(searchParams.get('limit') || '200', 10);
  const sort = searchParams.get('sort');
  const minLikes = parseInt(searchParams.get('minLikes') || '0', 10);          // 讚數門檻 (0 = 不限)
  const postedDays = searchParams.has('postedDays') ? parseFloat(searchParams.get('postedDays') || '0') : null; // 發文時間窗 (posted_at)
  const showAll = searchParams.get('all') === '1';
  const includeDisliked = searchParams.get('includeDisliked') === '1';
  const INTEREST_THRESHOLD = 15; // # of 👍 before auto-switching to interest-ranking
  const threshold = parseFloat(
    (db.prepare("SELECT value FROM settings WHERE key = 'trend_min_interest'").get() as { value: string } | undefined)?.value || '0.3',
  );
  // Display floor — never show 讚+留言 < this, even for posts recorded under an older rule
  // or 👍'd (they still anchor the profile, just don't surface). Mirrors the pipeline gate.
  const minEng = parseInt(
    (db.prepare("SELECT value FROM settings WHERE key = 'trend_min_engagement'").get() as { value: string } | undefined)?.value || '80', 10,
  );

  // Build the interest profile from 👍 (positive) and 👎 (negative) posts' embeddings.
  const profileRows = db.prepare(
    'SELECT interested, embedding FROM trend_posts WHERE interested != 0 AND embedding IS NOT NULL',
  ).all() as Array<{ interested: number; embedding: string }>;
  const likedVecs: number[][] = [];
  const dislikedVecs: number[][] = [];
  for (const r of profileRows) {
    const v = parseEmbedding(r.embedding);
    if (!v) continue;
    (r.interested === 1 ? likedVecs : dislikedVecs).push(v);
  }
  const counts = db.prepare(
    "SELECT sum(interested = 1) liked, sum(interested = -1) disliked FROM trend_posts",
  ).get() as { liked: number | null; disliked: number | null };
  const likedCount = counts.liked || 0;
  const dislikedCount = counts.disliked || 0;

  let query = `
    SELECT p.id, p.topic, p.source, p.author, p.text, p.like_count, p.reply_count, p.velocity,
           p.posted_at, p.permalink, p.relevant, p.interested, p.embedding, p.scraped_at,
           t.heat_score, t.status AS topic_status
    FROM trend_posts p LEFT JOIN trend_topics t ON t.id = p.topic_id
    WHERE p.scraped_at > datetime('now', ?)
      AND (p.source IS NULL OR p.source != 'seed_csv')
      AND (p.like_count + p.reply_count) >= ?
      AND COALESCE(p.dismissed, 0) = 0
  `;
  const qp: unknown[] = [`-${days} days`, minEng];
  if (minLikes > 0) { query += ' AND p.like_count >= ?'; qp.push(minLikes); }
  if (postedDays != null) { query += " AND p.posted_at IS NOT NULL AND datetime(p.posted_at) > datetime('now', ?)"; qp.push(`-${postedDays} days`); }
  if (topicId) { query += ' AND p.topic_id = ?'; qp.push(parseInt(topicId, 10)); }
  if (!includeDisliked) query += ' AND p.interested != -1'; // hide 👎 不要 posts by default
  query += ' ORDER BY p.relevant DESC, p.velocity DESC, p.scraped_at DESC';

  const rows = db.prepare(query).all(...qp) as Array<Record<string, unknown> & { embedding: string | null }>;

  // Score each post against the 👍/👎 profile, then strip the (large) embedding from the response.
  const hasProfile = likedVecs.length > 0 || dislikedVecs.length > 0;
  let posts = rows.map((r) => {
    const vec = parseEmbedding(r.embedding);
    const interest_score = vec && hasProfile ? interestScore(vec, likedVecs, dislikedVecs) : null;
    delete (r as { embedding?: string | null }).embedding;
    return { ...r, interest_score };
  });

  // Effective threshold: explicit ?minScore wins; else the configured hard filter (unless ?all=1).
  const explicitMin = searchParams.has('minScore') ? parseFloat(searchParams.get('minScore') || '0') : null;
  const minScore = explicitMin ?? (showAll ? 0 : threshold);
  const filtered = hasProfile && minScore > 0;
  if (filtered) {
    // Fail open: keep posts we couldn't score (null) so missing embeddings never hide content.
    posts = posts.filter((p) => p.interest_score == null || p.interest_score >= minScore);
  }

  // Sort is independent of the filter. Explicit ?sort wins (interest / newest / heat / scraped);
  // otherwise default to interest when we have a profile, else newest.
  const sortMode = sort === 'newest' || sort === 'heat' || sort === 'interest' || sort === 'scraped'
    ? sort
    : (hasProfile && (filtered || likedVecs.length >= INTEREST_THRESHOLD) ? 'interest' : 'newest');
  const timeMs = (p: Record<string, unknown>) => {
    const ms = Date.parse((p.posted_at as string) || (p.scraped_at as string) || '');
    return isNaN(ms) ? 0 : ms;
  };
  const scrapedMs = (p: Record<string, unknown>) => {
    const ms = Date.parse((p.scraped_at as string) || '');
    return isNaN(ms) ? 0 : ms;
  };
  const heat = (p: Record<string, unknown>) => Number(p.velocity) || 0;
  if (sortMode === 'interest' && hasProfile) {
    posts.sort((a, b) => (b.interest_score ?? -1) - (a.interest_score ?? -1));
  } else if (sortMode === 'heat') {
    posts.sort((a, b) => heat(b) - heat(a));
  } else if (sortMode === 'scraped') {
    posts.sort((a, b) => scrapedMs(b) - scrapedMs(a)); // most recently crawled
  } else {
    posts.sort((a, b) => timeMs(b) - timeMs(a)); // newest
  }
  const interestSort = sortMode === 'interest';

  posts = posts.slice(0, limit);
  const total = (db.prepare(
    "SELECT count(*) c FROM trend_posts WHERE scraped_at > datetime('now', ?) AND interested != -1 AND (source IS NULL OR source != 'seed_csv') AND (like_count + reply_count) >= ?",
  ).get(`-${days} days`, minEng) as { c: number }).c;
  return NextResponse.json({
    posts, total, likedCount, dislikedCount, profileSize: likedVecs.length,
    interestSort, sortMode, filtered, minInterest: minScore,
  });
}
