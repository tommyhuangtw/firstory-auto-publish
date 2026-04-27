import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { extractBeats } from '@/services/shortsPipeline';

export async function POST(request: NextRequest) {
  try {
    const { episodeNumber, avatarFilename } = await request.json() as { episodeNumber: number; avatarFilename?: string };
    if (!episodeNumber) {
      return NextResponse.json({ error: 'episodeNumber is required' }, { status: 400 });
    }

    const db = getDb();

    // Check episode exists and has script
    const episode = db.prepare('SELECT script_zh FROM episodes WHERE episode_number = ?').get(episodeNumber) as
      { script_zh: string | null } | undefined;
    if (!episode?.script_zh) {
      return NextResponse.json({ error: `Episode ${episodeNumber} not found or has no script` }, { status: 404 });
    }

    const beats = await extractBeats(episodeNumber);
    if (!beats || beats.length === 0) {
      return NextResponse.json({ error: 'No beats extracted from script' }, { status: 422 });
    }

    // Create shorts row
    const result = db.prepare(
      `INSERT INTO shorts (episode_number, status, beats_json, avatar_filename) VALUES (?, 'beats_ready', ?, ?)`
    ).run(episodeNumber, JSON.stringify(beats), avatarFilename || null);

    return NextResponse.json({
      shortsId: Number(result.lastInsertRowid),
      beats,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
