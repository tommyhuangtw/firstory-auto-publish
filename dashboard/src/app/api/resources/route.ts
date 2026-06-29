import { NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT r.id, r.guid, r.content_type, r.title, r.description, r.url, r.author, r.published_at, r.stars,
           r.likes, r.comments, r.reposts,
           r.star_velocity, r.freshness_reason, r.ai_score, r.ai_summary, r.ai_highlights,
           d.id AS draft_id, d.draft_text, d.viral_score
    FROM curated_resources r
    LEFT JOIN resource_drafts d ON d.id = (
      SELECT id FROM resource_drafts WHERE resource_guid = r.guid AND status != 'dismissed' ORDER BY id DESC LIMIT 1
    )
    WHERE r.status = 'surfaced'
    ORDER BY r.ai_score DESC, r.last_surfaced_at DESC
    LIMIT 100
  `).all();
  return NextResponse.json({ resources: rows });
}
