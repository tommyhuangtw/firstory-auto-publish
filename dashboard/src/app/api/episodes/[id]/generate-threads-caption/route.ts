import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:generate-threads-caption');

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const episodeId = parseInt(id);
  if (isNaN(episodeId)) {
    return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
  }

  const db = getDb();
  const episode = db.prepare(
    'SELECT id, episode_number, segment_type, selected_title, ig_caption FROM episodes WHERE id = ?'
  ).get(episodeId) as {
    id: number;
    episode_number: number | null;
    segment_type: string;
    selected_title: string | null;
    ig_caption: string | null;
  } | undefined;

  if (!episode) {
    return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
  }

  if (!episode.ig_caption) {
    return NextResponse.json({ error: '需要先有 IG 貼文才能生成 Threads 貼文' }, { status: 400 });
  }

  try {
    const { buildThreadsCaption } = await import('@/services/threads');
    const threadsCaption = await buildThreadsCaption({
      igCaption: episode.ig_caption,
      episodeTitle: episode.selected_title || '',
      episodeNumber: episode.episode_number || 0,
      segmentType: episode.segment_type || 'daily',
    });

    db.prepare('UPDATE episodes SET threads_caption = ? WHERE id = ?').run(threadsCaption, episodeId);
    log.info({ episodeId, length: threadsCaption.length }, 'Threads caption generated');

    return NextResponse.json({ threadsCaption });
  } catch (error) {
    log.error({ episodeId, error: (error as Error).message }, 'Failed to generate Threads caption');
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
