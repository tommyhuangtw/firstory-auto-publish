import { NextResponse } from 'next/server';
import { getDb } from '@/db';

/** Reply-zone feed: niche posts (likes>=30, recent), newest first. */
export async function GET() {
  const posts = getDb().prepare(`
    SELECT id, author, text, like_count, reply_count, permalink, posted_at, topic, source, reply_draft
    FROM trend_posts
    WHERE niche = 1 AND scraped_at > datetime('now', '-3 days')
    ORDER BY scraped_at DESC, like_count DESC
    LIMIT 100
  `).all();
  return NextResponse.json({ posts });
}
