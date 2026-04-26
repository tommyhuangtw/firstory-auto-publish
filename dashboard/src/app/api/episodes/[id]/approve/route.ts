import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { publishEpisode } from '@/services/pipeline/graph';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const episodeNumber = parseInt(id);
    if (isNaN(episodeNumber)) {
      return NextResponse.json({ error: 'Invalid episode number' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { selectedTitle, description, youtubeDescription } = body as { selectedTitle?: string; description?: string; youtubeDescription?: string };

    const db = getDb();

    // Update title/description if provided
    if (selectedTitle || description || youtubeDescription) {
      const updates: string[] = [];
      const values: unknown[] = [];

      if (selectedTitle) {
        updates.push('selected_title = ?');
        values.push(selectedTitle);
      }
      if (description) {
        updates.push('description = ?');
        values.push(description);
      }
      if (youtubeDescription) {
        updates.push('youtube_description = ?');
        values.push(youtubeDescription);
      }

      updates.push("status = 'approved'");
      updates.push("approved_at = datetime('now')");
      values.push(episodeNumber);

      db.prepare(`UPDATE episodes SET ${updates.join(', ')} WHERE episode_number = ?`).run(...values);
    } else {
      db.prepare(`UPDATE episodes SET status = 'approved', approved_at = datetime('now') WHERE episode_number = ?`)
        .run(episodeNumber);
    }

    // Start publishing
    const result = await publishEpisode(episodeNumber);

    return NextResponse.json({
      message: 'Episode approved and publishing',
      episodeNumber,
      soundonUrl: result.soundonUrl,
      youtubeUrl: result.youtubeUrl,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
