import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import fs from 'fs';
import path from 'path';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const episodeId = parseInt(id);
  if (isNaN(episodeId)) {
    return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
  }

  const db = getDb();
  const episode = db.prepare('SELECT audio_path, episode_number, segment_type FROM episodes WHERE id = ?').get(episodeId) as {
    audio_path: string | null;
    episode_number: number | null;
    segment_type: string;
  } | undefined;

  if (!episode || !episode.audio_path) {
    return NextResponse.json({ error: 'No audio file found' }, { status: 404 });
  }

  const audioPath = episode.audio_path;
  if (!fs.existsSync(audioPath)) {
    return NextResponse.json({ error: 'Audio file missing from disk' }, { status: 404 });
  }

  const ext = path.extname(audioPath) || '.mp3';
  const epLabel = episode.episode_number ? `ep${episode.episode_number}` : `id${episodeId}`;
  const filename = `${epLabel}_${episode.segment_type}_audio${ext}`;

  const stat = fs.statSync(audioPath);
  const stream = fs.readFileSync(audioPath);

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(stat.size),
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
