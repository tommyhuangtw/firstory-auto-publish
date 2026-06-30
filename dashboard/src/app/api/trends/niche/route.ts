import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

/**
 * Reply-zone feed: niche posts, filterable by min likes / post-age window / sort.
 * Query params (all optional, with sensible defaults matching the old hardcoded behaviour):
 *   minLikes — minimum like_count (default 30)
 *   days     — only posts published within the last N days (default 2)
 *   sort     — 'newest' (posted_at, default) | 'likes' (like_count) | 'scraped' (most recently crawled)
 * posted_at is stored as ISO (with T/Z), so normalise via datetime() before comparing to
 * avoid string-compare mismatches against SQLite's space-separated datetime('now', ...).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const minLikes = Math.max(0, Number(sp.get('minLikes')) || 30);
  const days = Math.min(30, Math.max(0.5, Number(sp.get('days')) || 2));
  const sort = sp.get('sort') || 'newest';
  const orderBy =
    sort === 'likes' ? 'like_count DESC, datetime(posted_at) DESC' :
    sort === 'scraped' ? 'datetime(scraped_at) DESC, datetime(posted_at) DESC' :
    'datetime(posted_at) DESC, like_count DESC';

  const posts = getDb().prepare(`
    SELECT id, author, text, like_count, reply_count, permalink, posted_at, scraped_at, topic, source, reply_draft
    FROM trend_posts
    WHERE niche = 1
      AND COALESCE(dismissed, 0) = 0
      AND posted_at IS NOT NULL
      AND like_count >= ?
      AND datetime(posted_at) > datetime('now', ?)
    ORDER BY ${orderBy}
    LIMIT 100
  `).all(minLikes, `-${days} days`);
  return NextResponse.json({ posts });
}
