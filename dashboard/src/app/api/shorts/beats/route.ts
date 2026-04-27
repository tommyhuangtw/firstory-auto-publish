import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { extractBeats } from '@/services/shortsPipeline';

export async function POST(request: NextRequest) {
  try {
    const { episodeId, avatarFilename } = await request.json() as { episodeId: number; avatarFilename?: string };
    if (!episodeId) {
      return NextResponse.json({ error: 'episodeId is required' }, { status: 400 });
    }

    const db = getDb();

    // Check episode exists and has script
    const episode = db.prepare('SELECT episode_number, script_zh FROM episodes WHERE id = ?').get(episodeId) as
      { episode_number: number | null; script_zh: string | null } | undefined;
    if (!episode?.script_zh) {
      return NextResponse.json({ error: `Episode ${episodeId} not found or has no script` }, { status: 404 });
    }

    const beats = await extractBeats(episodeId);
    if (!beats || beats.length === 0) {
      return NextResponse.json({ error: 'No beats extracted from script' }, { status: 422 });
    }

    // Create shorts row (episode_number included for NOT NULL constraint on existing DBs)
    const result = db.prepare(
      `INSERT INTO shorts (episode_number, episode_id, status, beats_json, avatar_filename) VALUES (?, ?, 'beats_ready', ?, ?)`
    ).run(episode.episode_number ?? episodeId, episodeId, JSON.stringify(beats), avatarFilename || null);

    return NextResponse.json({
      shortsId: Number(result.lastInsertRowid),
      beats,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
