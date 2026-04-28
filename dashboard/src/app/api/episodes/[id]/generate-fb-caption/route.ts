import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:generate-fb-caption');

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
    'SELECT id, episode_number, segment_type, selected_title, ig_caption, source_links FROM episodes WHERE id = ?'
  ).get(episodeId) as {
    id: number;
    episode_number: number | null;
    segment_type: string;
    selected_title: string | null;
    ig_caption: string | null;
    source_links: string | null;
  } | undefined;

  if (!episode) {
    return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
  }

  if (!episode.ig_caption) {
    return NextResponse.json({ error: '需要先有 IG 貼文才能生成 FB 貼文' }, { status: 400 });
  }

  try {
    const { buildFacebookCaption } = await import('@/services/facebook');
    const fbCaption = await buildFacebookCaption({
      igCaption: episode.ig_caption,
      sourceLinks: JSON.parse(episode.source_links || '[]'),
      episodeTitle: episode.selected_title || '',
      episodeNumber: episode.episode_number || 0,
      segmentType: episode.segment_type || 'daily',
    });

    // Save to DB
    db.prepare('UPDATE episodes SET fb_caption = ? WHERE id = ?').run(fbCaption, episodeId);
    log.info({ episodeId, length: fbCaption.length }, 'FB caption generated');

    return NextResponse.json({ fbCaption });
  } catch (error) {
    log.error({ episodeId, error: (error as Error).message }, 'Failed to generate FB caption');
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
