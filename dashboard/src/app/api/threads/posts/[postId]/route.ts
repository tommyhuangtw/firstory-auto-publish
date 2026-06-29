import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
) {
  const { postId } = await params;
  const db = getDb();

  const post = db.prepare(`
    SELECT post_id, text, media_type, permalink, posted_at,
           views, likes, replies, reposts, quotes, shares, engagement_rate,
           is_repost, fetched_at, insights_at
    FROM threads_posts
    WHERE post_id = ?
  `).get(postId) as Record<string, unknown> | undefined;

  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }

  return NextResponse.json({ post });
}