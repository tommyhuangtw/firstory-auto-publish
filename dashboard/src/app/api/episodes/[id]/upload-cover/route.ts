import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import fs from 'fs-extra';
import path from 'path';

const log = createChildLogger('api:upload-cover');
const OUTPUT_DIR = path.join(process.cwd(), '..', 'temp', 'covers');

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
    const file = formData.get('cover') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const ext = path.extname(file.name) || '.png';
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
    const filename = `${dateStr}_${timeStr}_manual_cover${ext}`;
    const localPath = path.join(OUTPUT_DIR, filename);

    await fs.ensureDir(OUTPUT_DIR);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(localPath, buffer);

    // Upload to Cloudinary if configured
    let publicUrl = '';
    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_UPLOAD_PRESET) {
      const { uploadToCloudinary } = await import('@/services/cloudinary');
      publicUrl = await uploadToCloudinary(localPath, filename);
    }

    // Append to cover_candidates and set as active cover
    const row = db.prepare('SELECT cover_candidates FROM episodes WHERE id = ?').get(episodeId) as { cover_candidates: string | null } | undefined;
    const candidates: { path: string; url: string; createdAt: string; source: string }[] = row?.cover_candidates ? JSON.parse(row.cover_candidates) : [];
    candidates.push({
      path: localPath,
      url: publicUrl || '',
      createdAt: new Date().toISOString(),
      source: 'upload',
    });

    db.prepare('UPDATE episodes SET cover_path = ?, cover_url = ?, cover_candidates = ? WHERE id = ?')
      .run(localPath, publicUrl || null, JSON.stringify(candidates), episodeId);

    log.info({ episodeId, coverPath: localPath, totalCandidates: candidates.length }, 'Manual cover uploaded');

    return NextResponse.json({ coverPath: localPath, coverUrl: publicUrl, candidates });
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Cover upload failed');
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
