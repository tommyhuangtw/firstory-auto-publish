import { NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT r.*, d.id AS draft_id, d.draft_text, d.viral_score, d.status AS draft_status
    FROM curated_resources r
    LEFT JOIN resource_drafts d ON d.resource_guid = r.guid
    WHERE r.status != 'dismissed'
    ORDER BY r.last_surfaced_at DESC, d.id DESC LIMIT 100
  `).all();
  return NextResponse.json({ resources: rows });
}
