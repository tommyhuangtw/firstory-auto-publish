import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

/**
 * List every scraped post for tracking. Includes posts from topics that did NOT
 * become drafts (status='skipped'), so nothing the bot saw is lost.
 * Filters: ?topic_id= , ?days= (default 7), ?limit= (default 200).
 */
export async function GET(request: NextRequest) {
  const db = getDb();
  const { searchParams } = request.nextUrl;
  const topicId = searchParams.get('topic_id');
  const days = parseInt(searchParams.get('days') || '7', 10);
  const limit = parseInt(searchParams.get('limit') || '200', 10);

  let query = `
    SELECT p.id, p.topic, p.source, p.author, p.text, p.like_count, p.reply_count, p.velocity,
           p.posted_at, p.permalink, p.relevant, p.scraped_at, t.heat_score, t.status AS topic_status
    FROM trend_posts p LEFT JOIN trend_topics t ON t.id = p.topic_id
    WHERE p.scraped_at > datetime('now', ?)
  `;
  const params: unknown[] = [`-${days} days`];
  if (topicId) {
    query += ' AND p.topic_id = ?';
    params.push(parseInt(topicId, 10));
  }
  query += ' ORDER BY p.relevant DESC, p.velocity DESC, p.scraped_at DESC LIMIT ?';
  params.push(limit);

  const posts = db.prepare(query).all(...params);
  const total = (db.prepare('SELECT count(*) AS c FROM trend_posts').get() as { c: number }).c;
  return NextResponse.json({ posts, total });
}
