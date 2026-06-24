import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { decodeHtmlEntities } from '@/services/inspiration/sources';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const row = db.prepare(
    `SELECT cs.id, cs.url, cs.source_type, cs.title, cs.status, cs.error_message, cs.cost_usd, cs.transcript,
            cs.channel_name, ch.title AS channel_title
     FROM content_summaries cs LEFT JOIN channels ch ON ch.id = cs.channel_id
     WHERE cs.id = ?`,
  ).get(Number(id)) as Record<string, unknown> | undefined;
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (typeof row.transcript === 'string') row.transcript = decodeHtmlEntities(row.transcript);
  const insights = db.prepare('SELECT id, hook, idea, category, resonance FROM insights WHERE source_id = ? ORDER BY id').all(Number(id));
  return NextResponse.json({ ...row, insightCount: insights.length, insights });
}
