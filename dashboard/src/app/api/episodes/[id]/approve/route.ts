import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { publishEpisode } from '@/services/pipeline/graph';

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
      values.push(episodeId);

      db.prepare(`UPDATE episodes SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    } else {
      db.prepare(`UPDATE episodes SET status = 'approved', approved_at = datetime('now') WHERE id = ?`)
        .run(episodeId);
    }

    // Start publishing (assigns episode number from RSS)
    const result = await publishEpisode(episodeId);

    return NextResponse.json({
      message: 'Episode approved and publishing',
      episodeId,
      episodeNumber: result.episodeNumber,
      soundonUrl: result.soundonUrl,
      youtubeUrl: result.youtubeUrl,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
