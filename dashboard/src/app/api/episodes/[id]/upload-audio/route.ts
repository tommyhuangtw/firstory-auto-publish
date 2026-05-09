import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import fs from 'fs-extra';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const log = createChildLogger('api:upload-audio');
const execAsync = promisify(exec);
const OUTPUT_DIR = path.join(process.cwd(), '..', 'temp', 'tts');
const ALLOWED_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg']);

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
    const episode = db.prepare('SELECT id, audio_path, original_audio_path FROM episodes WHERE id = ?').get(episodeId) as {
      id: number;
      audio_path: string | null;
      original_audio_path: string | null;
    } | undefined;
    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get('audio') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const ext = path.extname(file.name).toLowerCase() || '.mp3';
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json({ error: `Unsupported format: ${ext}` }, { status: 400 });
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
    const filename = `${dateStr}_${timeStr}_manual_audio${ext}`;
    const localPath = path.join(OUTPUT_DIR, filename);

    await fs.ensureDir(OUTPUT_DIR);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(localPath, buffer);

    // Probe duration with ffprobe
    let durationSec: number | null = null;
    try {
      const { stdout } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${localPath}"`
      );
      durationSec = parseFloat(stdout.trim());
    } catch {
      log.warn('Could not probe audio duration');
    }

    // Save original audio path on first replacement
    if (!episode.original_audio_path && episode.audio_path) {
      db.prepare('UPDATE episodes SET original_audio_path = ? WHERE id = ?')
        .run(episode.audio_path, episodeId);
    }

    // Update audio_path (and duration if available)
    if (durationSec != null) {
      db.prepare('UPDATE episodes SET audio_path = ?, audio_duration_sec = ? WHERE id = ?')
        .run(localPath, durationSec, episodeId);
    } else {
      db.prepare('UPDATE episodes SET audio_path = ? WHERE id = ?')
        .run(localPath, episodeId);
    }

    log.info({ episodeId, audioPath: localPath, durationSec }, 'Manual audio uploaded');

    return NextResponse.json({ audioPath: localPath, durationSec });
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Audio upload failed');
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
