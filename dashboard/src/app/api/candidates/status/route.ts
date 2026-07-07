import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

const VALID = new Set(['new', 'saved', 'dismissed', 'used']);

// Batch-update candidate status. Body: { ids: number[], status }
export async function POST(request: NextRequest) {
  const { ids, status } = (await request.json()) as { ids?: number[]; status?: string };
  if (!Array.isArray(ids) || !ids.length || !status || !VALID.has(status)) {
    return NextResponse.json({ error: 'ids[] and a valid status are required' }, { status: 400 });
  }
  const stmt = getDb().prepare('UPDATE episode_candidates SET status = ? WHERE id = ?');
  const tx = getDb().transaction((rows: number[]) => {
    for (const id of rows) stmt.run(status, id);
  });
  tx(ids);
  return NextResponse.json({ ok: true, updated: ids.length });
}
