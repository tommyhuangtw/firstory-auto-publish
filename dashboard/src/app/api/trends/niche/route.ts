import { NextResponse } from 'next/server';
import { getDb } from '@/db';

/** Reply-zone feed: niche posts (likes>=30) posted within the last 1.5 days, newest first. */
export async function GET() {
  // Filter by the post's own age (posted_at), not scrape time — the reply zone should
  // only surface posts published within the last 1.5 days. posted_at is stored as ISO
  // (with T/Z), so normalise via datetime() before comparing to avoid string-compare
  // mismatches against SQLite's space-separated datetime('now', ...).
  const posts = getDb().prepare(`
    SELECT id, author, text, like_count, reply_count, permalink, posted_at, topic, source, reply_draft
    FROM trend_posts
    WHERE niche = 1
      AND posted_at IS NOT NULL
      AND datetime(posted_at) > datetime('now', '-1.5 days')
    ORDER BY datetime(posted_at) DESC, like_count DESC
    LIMIT 100
  `).all();
  return NextResponse.json({ posts });
}
