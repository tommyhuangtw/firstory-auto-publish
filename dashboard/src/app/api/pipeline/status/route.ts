import { NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET() {
  const db = getDb();

  const runs = db
    .prepare(
      `SELECT id, episode_number, segment_type, status, current_stage, started_at, completed_at
       FROM pipeline_runs ORDER BY started_at DESC LIMIT 10`
    )
    .all();

  const stats = db
    .prepare(
      `SELECT status, count(*) as count FROM pipeline_runs GROUP BY status`
    )
    .all();

  return NextResponse.json({ runs, stats });
}
