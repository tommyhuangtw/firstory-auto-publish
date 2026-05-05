import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const runId = parseInt(id);
  if (isNaN(runId)) {
    return NextResponse.json({ error: 'Invalid run ID' }, { status: 400 });
  }

  const db = getDb();
  const run = db.prepare(
    `SELECT id, episode_number, segment_type, status, current_stage,
            started_at, completed_at, error_log
     FROM pipeline_runs WHERE id = ?`
  ).get(runId);

  if (!run) {
    return NextResponse.json({ error: 'Pipeline run not found' }, { status: 404 });
  }

  return NextResponse.json(run);
}
