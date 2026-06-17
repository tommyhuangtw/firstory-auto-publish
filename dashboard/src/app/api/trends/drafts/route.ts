import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

/** List trend drafts joined with their topic, newest first. */
export async function GET(request: NextRequest) {
  const db = getDb();
  const { searchParams } = request.nextUrl;
  const status = searchParams.get('status');
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  let query = `
    SELECT d.id, d.topic_id, d.draft_text, d.format_suggestion, d.format_reason,
           d.char_count, d.status, d.task_id, d.reviewed_at, d.created_at,
           t.topic, t.heat_score, t.rideability, t.risk_level, t.risk_reason,
           t.sample_posts, t.post_count, t.top_velocity
    FROM trend_drafts d
    JOIN trend_topics t ON t.id = d.topic_id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  if (status) {
    query += ' AND d.status = ?';
    params.push(status);
  }
  query += ' ORDER BY t.heat_score DESC, d.created_at DESC LIMIT ?';
  params.push(limit);

  const drafts = db.prepare(query).all(...params) as Array<{ topic_id: number }>;

  // Attach every recorded post for each topic (clickable permalinks, ranked by velocity).
  const postsStmt = db.prepare(`
    SELECT author, text, like_count, reply_count, velocity, posted_at, permalink
    FROM trend_posts WHERE topic_id = ? ORDER BY velocity DESC
  `);
  const withPosts = drafts.map((d) => ({ ...d, posts: postsStmt.all(d.topic_id) }));

  return NextResponse.json({ drafts: withPosts });
}
