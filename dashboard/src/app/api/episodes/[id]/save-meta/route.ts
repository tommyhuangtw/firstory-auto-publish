import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const episodeNumber = parseInt(id);
  if (isNaN(episodeNumber)) {
    return NextResponse.json({ error: 'Invalid episode number' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { selectedTitle, description, igCaption } = body as {
      selectedTitle?: string;
      description?: string;
      igCaption?: string;
    };

    const db = getDb();

    if (selectedTitle !== undefined) {
      db.prepare('UPDATE episodes SET selected_title = ? WHERE episode_number = ?')
        .run(selectedTitle, episodeNumber);
    }
    if (description !== undefined) {
      // Sync both description fields (they share the same content)
      db.prepare('UPDATE episodes SET description = ?, youtube_description = ? WHERE episode_number = ?')
        .run(description, description, episodeNumber);
    }
    if (igCaption !== undefined) {
      db.prepare('UPDATE episodes SET ig_caption = ? WHERE episode_number = ?')
        .run(igCaption, episodeNumber);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
