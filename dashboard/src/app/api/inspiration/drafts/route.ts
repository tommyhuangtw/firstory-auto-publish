import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET(_request: NextRequest) {
  const db = getDb();
  const drafts = db.prepare(
    `SELECT d.*, i.hook FROM insight_drafts d JOIN insights i ON i.id = d.insight_id ORDER BY d.created_at DESC LIMIT 100`,
  ).all();
  return NextResponse.json({ drafts });
}
