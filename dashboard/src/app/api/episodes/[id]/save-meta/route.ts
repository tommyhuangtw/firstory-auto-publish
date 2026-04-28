import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const episodeId = parseInt(id);
  if (isNaN(episodeId)) {
    return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { selectedTitle, description, igCaption, fbCaption } = body as {
      selectedTitle?: string;
      description?: string;
      igCaption?: string;
      fbCaption?: string;
    };

    const db = getDb();

    if (selectedTitle !== undefined) {
      db.prepare('UPDATE episodes SET selected_title = ? WHERE id = ?')
        .run(selectedTitle, episodeId);
    }
    if (description !== undefined) {
      // Sync both description fields (they share the same content)
      db.prepare('UPDATE episodes SET description = ?, youtube_description = ? WHERE id = ?')
        .run(description, description, episodeId);
    }
    if (igCaption !== undefined) {
      db.prepare('UPDATE episodes SET ig_caption = ? WHERE id = ?')
        .run(igCaption, episodeId);
    }
    if (fbCaption !== undefined) {
      db.prepare('UPDATE episodes SET fb_caption = ? WHERE id = ?')
        .run(fbCaption, episodeId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
