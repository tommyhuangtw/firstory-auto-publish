import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

/** Full detail of one crawl run: the funnel + EVERY dropped post with its filter reason
 *  (below_floor / stale / duplicate) + the posts it actually recorded. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = parseInt(id, 10);
  if (isNaN(runId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const db = getDb();
  const run = db.prepare('SELECT * FROM trend_scan_runs WHERE id = ?').get(runId) as
    (Record<string, unknown> & { topics: string | null; dropped: string | null }) | undefined;
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const parsed = {
    ...run,
    topics: run.topics ? safeParse(run.topics) : [],
    dropped: run.dropped ? safeParse(run.dropped) : [],
  };

  const recorded = db.prepare(
    `SELECT id, author, text, like_count, reply_count, relevant, source, permalink
     FROM trend_posts WHERE scan_run_id = ?
     ORDER BY relevant DESC, (like_count + reply_count) DESC`,
  ).all(runId);

  return NextResponse.json({ run: parsed, recorded });
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return []; }
}
