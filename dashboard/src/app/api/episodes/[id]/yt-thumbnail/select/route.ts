import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

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

    const { thumbnailPath, hookTitle } = (await request.json()) as {
      thumbnailPath: string;
      hookTitle: string;
    };

    if (!thumbnailPath) {
      return NextResponse.json({ error: 'thumbnailPath required' }, { status: 400 });
    }

    const db = getDb();
    db.prepare('UPDATE episodes SET yt_thumbnail_path = ?, yt_hook_title = ? WHERE id = ?')
      .run(thumbnailPath, hookTitle, episodeId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
