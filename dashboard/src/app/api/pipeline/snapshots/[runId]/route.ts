import { NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const id = parseInt(runId);
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid runId' }, { status: 400 });
  }

  const db = getDb();
  const snapshots = db.prepare(
    `SELECT id, stage, output_data, started_at, elapsed_ms
     FROM pipeline_snapshots
     WHERE pipeline_run_id = ?
     ORDER BY id ASC`
  ).all(id);

  return NextResponse.json({ snapshots });
}
