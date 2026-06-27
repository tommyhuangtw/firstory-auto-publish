import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

/**
 * List Threads posts. Sort is whitelisted (never interpolate raw user input into SQL).
 * Default = like_comment: likes + replies×3 (a comment is far more effort than a like),
 * which surfaces the posts the audience actually engaged with — unlike engagement_rate,
 * which over-rewards low-view posts that happened to get a few shares.
 */
const SORTS: Record<string, string> = {
  like_comment: '(likes + replies * 3) DESC, posted_at DESC',
  likes: 'likes DESC, posted_at DESC',
  engagement: 'engagement_rate DESC, posted_at DESC',
  recent: 'posted_at DESC',
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sort = SORTS[searchParams.get('sort') || ''] || SORTS.like_comment;
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
