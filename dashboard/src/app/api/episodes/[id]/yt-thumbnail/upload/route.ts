import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import fs from 'fs-extra';
import path from 'path';

const log = createChildLogger('api:yt-thumbnail-upload');
const OUTPUT_DIR = path.join(process.cwd(), '..', 'temp', 'thumbnails');

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

    const formData = await request.formData();
    const file = formData.get('thumbnail') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Use JPEG, PNG, or WebP.' }, { status: 400 });
    }

    const ext = path.extname(file.name) || '.png';
    const filename = `ep${episodeId}_yt_upload_${Date.now()}${ext}`;
    const localPath = path.join(OUTPUT_DIR, filename);

    await fs.ensureDir(OUTPUT_DIR);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(localPath, buffer);

    log.info({ episodeId, path: localPath }, 'Custom YouTube thumbnail uploaded');

    return NextResponse.json({
      thumbnail: {
        path: localPath,
        url: `/api/thumbnail-compare/serve?file=${encodeURIComponent(filename)}`,
        style: '自訂上傳',
      },
    });
  } catch (error) {
    log.error({ error: (error as Error).message }, 'YouTube thumbnail upload failed');
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
