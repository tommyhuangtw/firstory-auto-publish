import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { interestScore, parseEmbedding } from '@/services/trends/embeddings';

/**
 * List scraped posts. Each post gets an `interest_score` (0..1) = semantic similarity
 * to the set of 👍 想留 posts. Two-stage: once enough 👍 accumulate (or ?sort=interest),
 * posts are ranked by interest; otherwise by AI-relevance + velocity. ?minScore filters.
 * Other filters: ?topic_id, ?days (default 7), ?limit (default 200).
 */
export async function GET(request: NextRequest) {
  const db = getDb();
  const { searchParams } = request.nextUrl;
  const topicId = searchParams.get('topic_id');
  const days = parseInt(searchParams.get('days') || '7', 10);
  const limit = parseInt(searchParams.get('limit') || '200', 10);
  const sort = searchParams.get('sort');
  const minScore = parseFloat(searchParams.get('minScore') || '0');
  const includeDisliked = searchParams.get('includeDisliked') === '1';
  const INTEREST_THRESHOLD = 15; // # of 👍 before auto-switching to interest-ranking

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
  `;
  const qp: unknown[] = [`-${days} days`];
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

  if (hasProfile && minScore > 0) {
    posts = posts.filter((p) => (p.interest_score ?? -1) >= minScore);
  }

  const interestSort = sort === 'interest' || likedVecs.length >= INTEREST_THRESHOLD;
  if (interestSort && hasProfile) {
    posts.sort((a, b) => (b.interest_score ?? -1) - (a.interest_score ?? -1));
  }

  posts = posts.slice(0, limit);
  const total = (db.prepare('SELECT count(*) AS c FROM trend_posts').get() as { c: number }).c;
  return NextResponse.json({
    posts, total, likedCount, dislikedCount, profileSize: likedVecs.length, interestSort,
  });
}
