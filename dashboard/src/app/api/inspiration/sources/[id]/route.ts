import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const row = db.prepare('SELECT id, url, source_type, title, status, error_message, cost_usd FROM content_summaries WHERE id = ?').get(Number(id));
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const insightCount = (db.prepare('SELECT COUNT(*) c FROM insights WHERE source_id = ?').get(Number(id)) as { c: number }).c;
  return NextResponse.json({ ...row, insightCount });
}
