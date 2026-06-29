import { NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT r.*, d.id AS draft_id, d.draft_text, d.viral_score, d.status AS draft_status
    FROM curated_resources r
    LEFT JOIN resource_drafts d ON d.id = (
      SELECT id FROM resource_drafts
      WHERE resource_guid = r.guid AND status != 'dismissed'
      ORDER BY id DESC LIMIT 1
    )
    WHERE r.status = 'surfaced'
      AND EXISTS (SELECT 1 FROM resource_drafts d2 WHERE d2.resource_guid = r.guid AND d2.status != 'dismissed')
    ORDER BY r.last_surfaced_at DESC
    LIMIT 100
  `).all();
  return NextResponse.json({ resources: rows });
}
