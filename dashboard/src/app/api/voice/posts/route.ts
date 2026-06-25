import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

/** List Threads posts. Default sort = engagement_rate DESC ("audience liked"). */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sort = searchParams.get('sort') === 'recent' ? 'posted_at DESC' : 'engagement_rate DESC';
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));
  const includeReposts = searchParams.get('includeReposts') === '1';
  const where = includeReposts ? '' : 'WHERE is_repost = 0';

  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) c FROM threads_posts ${where}`).get() as { c: number }).c;
  const posts = db.prepare(`
    SELECT post_id, text, media_type, permalink, posted_at,
           views, likes, replies, reposts, quotes, shares, engagement_rate
    FROM threads_posts ${where}
    ORDER BY ${sort} LIMIT ? OFFSET ?
  `).all(limit, offset);

  return NextResponse.json({ posts, total });
}
