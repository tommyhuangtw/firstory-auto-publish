import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { interestScore, parseEmbedding } from '@/services/trends/embeddings';

/**
 * Next batch of unlabeled seed_csv posts to label, ordered for efficiency:
 *  - cold start (< ACTIVE_AT labels): highest engagement first — these matter most to
 *    filter and span diverse topics, building a broad profile fast.
 *  - once seeded: active learning — most BORDERLINE posts first (|interest_score − threshold|
 *    ascending), so each 👍/👎 maximally sharpens the keep/drop boundary.
 * Labeling is resumable: marks persist, so each call just serves the next best unlabeled.
 * ?limit (default 20), ?exclude=comma,ids (skip ids handled this session).
 */
const ACTIVE_AT = 25; // # of labels before switching to uncertainty ordering

export async function GET(request: NextRequest) {
  const db = getDb();
  const { searchParams } = request.nextUrl;
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);
  const exclude = (searchParams.get('exclude') || '').split(',').map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));

  const counts = db.prepare(
    "SELECT sum(interested = 1) liked, sum(interested = -1) disliked FROM trend_posts",
  ).get() as { liked: number | null; disliked: number | null };
  const likedCount = counts.liked || 0;
  const dislikedCount = counts.disliked || 0;
  const labeledTotal = likedCount + dislikedCount;

  const remaining = (db.prepare(
    "SELECT count(*) c FROM trend_posts WHERE source = 'seed_csv' AND interested = 0",
  ).get() as { c: number }).c;
  const unembedded = (db.prepare(
    "SELECT count(*) c FROM trend_posts WHERE source = 'seed_csv' AND embedding IS NULL",
  ).get() as { c: number }).c;

  const excludeClause = exclude.length ? ` AND id NOT IN (${exclude.map(() => '?').join(',')})` : '';
  const base = `SELECT id, author, text, like_count, reply_count, posted_at, permalink, relevant, embedding
                FROM trend_posts WHERE source = 'seed_csv' AND interested = 0${excludeClause}`;

  type Row = Record<string, unknown> & { id: number; embedding: string | null };
  let queue: Array<Omit<Row, 'embedding'> & { interest_score: number | null }>;

  if (labeledTotal < ACTIVE_AT) {
    // Cold start: top engagement.
    const rows = db.prepare(
      `${base} ORDER BY (like_count + reply_count) DESC LIMIT ?`,
    ).all(...exclude, limit) as Row[];
    queue = rows.map((r) => { delete (r as { embedding?: unknown }).embedding; return { ...r, interest_score: null }; });
  } else {
    // Active learning: score the embedded unlabeled pool, serve the most borderline first.
    const threshold = parseFloat(
      (db.prepare("SELECT value FROM settings WHERE key = 'trend_min_interest'").get() as { value: string } | undefined)?.value || '0.3',
    );
    const profile = db.prepare(
      "SELECT interested, embedding FROM trend_posts WHERE interested != 0 AND embedding IS NOT NULL",
    ).all() as Array<{ interested: number; embedding: string }>;
    const likedVecs: number[][] = [], dislikedVecs: number[][] = [];
    for (const p of profile) { const v = parseEmbedding(p.embedding); if (v) (p.interested === 1 ? likedVecs : dislikedVecs).push(v); }

    // Cap how many candidates we score per request (engagement-prioritized) to stay fast.
    const rows = db.prepare(
      `${base} AND embedding IS NOT NULL ORDER BY (like_count + reply_count) DESC LIMIT 1500`,
    ).all(...exclude) as Row[];
    const scored = rows.map((r) => {
      const vec = parseEmbedding(r.embedding);
      const interest_score = vec ? interestScore(vec, likedVecs, dislikedVecs) : null;
      delete (r as { embedding?: unknown }).embedding;
      return { ...r, interest_score };
    });
    scored.sort((a, b) => Math.abs((a.interest_score ?? 1) - threshold) - Math.abs((b.interest_score ?? 1) - threshold));
    queue = scored.slice(0, limit);
  }

  return NextResponse.json({
    queue, likedCount, dislikedCount, labeledTotal, remaining, unembedded,
    mode: labeledTotal < ACTIVE_AT ? 'engagement' : 'active',
  });
}
