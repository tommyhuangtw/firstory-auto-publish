import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { regenerateDescription } from '@/services/pipeline/nodes/generateMeta';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:regenerate-description');

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const episodeNumber = parseInt(id);
    if (isNaN(episodeNumber)) {
      return NextResponse.json({ error: 'Invalid episode number' }, { status: 400 });
    }

    const db = getDb();
    const episode = db.prepare(
      'SELECT segment_type, script_zh, script_en FROM episodes WHERE episode_number = ?'
    ).get(episodeNumber) as { segment_type: string; script_zh: string | null; script_en: string | null } | undefined;

    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    const scriptContent = episode.script_zh || episode.script_en || '';
    if (!scriptContent) {
      return NextResponse.json({ error: 'No script content available' }, { status: 400 });
    }

    log.info({ episodeNumber, segmentType: episode.segment_type }, 'Regenerating description');

    const description = await regenerateDescription(
      episode.segment_type,
      scriptContent,
      episodeNumber,
    );

    // Save to both description and youtube_description
    db.prepare(
      'UPDATE episodes SET description = ?, youtube_description = ? WHERE episode_number = ?'
    ).run(description, description, episodeNumber);

    log.info({ episodeNumber, descLength: description.length }, 'Description regenerated');

    return NextResponse.json({ description });
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Description regeneration failed');
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
