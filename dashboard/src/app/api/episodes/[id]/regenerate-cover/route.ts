import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { enqueueTask, getTasksForEpisode } from '@/services/coverTaskQueue';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:regenerate-cover');

// POST: Enqueue a cover generation task (returns immediately)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const episodeId = parseInt(id);
    if (isNaN(episodeId)) {
      return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
    }

    const db = getDb();
    const episode = db.prepare('SELECT id FROM episodes WHERE id = ?').get(episodeId);
    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    // Optional body:
    //  - holiday: 'none' = force plain cover; a key = force that holiday; absent = auto-detect.
    //  - contextText / contextImageUrl: user news/topic context (augments summary, skips holiday).
    let holidayOverride: string | undefined;
    let contextText: string | undefined;
    let contextImageUrl: string | undefined;
    try {
      const body = await request.json();
      if (typeof body?.holiday === 'string') holidayOverride = body.holiday;
      if (typeof body?.contextText === 'string') contextText = body.contextText;
      if (typeof body?.contextImageUrl === 'string') contextImageUrl = body.contextImageUrl;
    } catch { /* no body / not JSON → auto-detect, no context */ }

    const task = enqueueTask(episodeId, { holidayOverride, contextText, contextImageUrl });
    log.info(
      { episodeId, taskId: task.taskId, holidayOverride: holidayOverride ?? null, hasContext: !!(contextText || contextImageUrl) },
      'Cover generation task enqueued',
    );

    return NextResponse.json({
      taskId: task.taskId,
      status: task.status,
    });
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Failed to enqueue cover generation');
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// GET: Poll task status for this episode
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const episodeId = parseInt(id);
  if (isNaN(episodeId)) {
    return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
  }

  const tasks = getTasksForEpisode(episodeId);

  // Also return latest candidates from DB so UI can refresh gallery
  const db = getDb();
  const row = db.prepare('SELECT cover_candidates, cover_path FROM episodes WHERE id = ?').get(episodeId) as {
    cover_candidates: string | null;
    cover_path: string | null;
  } | undefined;

  return NextResponse.json({
    tasks,
    candidates: row?.cover_candidates ? JSON.parse(row.cover_candidates) : [],
    activeCoverPath: row?.cover_path || null,
  });
}
