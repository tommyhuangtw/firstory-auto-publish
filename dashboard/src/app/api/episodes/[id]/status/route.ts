import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const episodeId = parseInt(id);
    if (isNaN(episodeId)) {
      return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
    }

    const db = getDb();
    const episode = db.prepare(
      'SELECT id, episode_number, status, selected_title, soundon_url, youtube_url, published_at, approved_at FROM episodes WHERE id = ?'
    ).get(episodeId) as Record<string, unknown> | undefined;

    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    return NextResponse.json(episode);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
