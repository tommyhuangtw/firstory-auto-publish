import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

// Stop a generating episode. Marks its running pipeline_run 'cancelled' — a live pipeline
// aborts at the next node boundary (wrapNode checks this flag); an orphaned run is just
// corrected. Body: { episodeId } or { pipelineRunId }.
export async function POST(request: NextRequest) {
  const { episodeId, pipelineRunId } = (await request.json().catch(() => ({}))) as {
    episodeId?: number; pipelineRunId?: number;
  };
  if (!episodeId && !pipelineRunId) {
    return NextResponse.json({ error: 'episodeId or pipelineRunId required' }, { status: 400 });
  }
  const db = getDb();

  let runId = pipelineRunId;
  if (!runId && episodeId) {
    const r = db.prepare(
      "SELECT id FROM pipeline_runs WHERE episode_id = ? AND status = 'running' ORDER BY id DESC",
    ).get(episodeId) as { id: number } | undefined;
    runId = r?.id;
  }

  if (runId) {
    db.prepare(
      "UPDATE pipeline_runs SET status = 'cancelled', completed_at = datetime('now') WHERE id = ? AND status = 'running'",
    ).run(runId);
  }

  const eid = episodeId
    ?? (runId ? (db.prepare('SELECT episode_id FROM pipeline_runs WHERE id = ?').get(runId) as { episode_id: number } | undefined)?.episode_id : undefined);
  if (eid) {
    db.prepare(
      "UPDATE episodes SET status = 'cancelled' WHERE id = ? AND status IN ('generating', 'publishing')",
    ).run(eid);
  }

  return NextResponse.json({ ok: true, cancelledRun: runId ?? null, episodeId: eid ?? null });
}
