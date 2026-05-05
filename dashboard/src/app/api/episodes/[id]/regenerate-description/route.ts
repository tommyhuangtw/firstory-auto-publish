import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { regenerateDescription, appendSourceLinks } from '@/services/pipeline/nodes/generateMeta';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:regenerate-description');

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const episodeId = parseInt(id);
    if (isNaN(episodeId)) {
      return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
    }

    const db = getDb();
    const episode = db.prepare(
      'SELECT segment_type, script_zh, script_en, source_links FROM episodes WHERE id = ?'
    ).get(episodeId) as { segment_type: string; script_zh: string | null; script_en: string | null; source_links: string | null } | undefined;

    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    const scriptContent = episode.script_zh || episode.script_en || '';
    if (!scriptContent) {
      return NextResponse.json({ error: 'No script content available' }, { status: 400 });
    }

    log.info({ episodeId, segmentType: episode.segment_type }, 'Regenerating description');

    const baseDescription = await regenerateDescription(
      episode.segment_type,
      scriptContent,
      episodeId,
    );

    // Append source links (same as pipeline generateMeta)
    const sourceLinks = JSON.parse(episode.source_links || '[]');
    const description = appendSourceLinks(baseDescription, sourceLinks);

    // Save to both description and youtube_description
    db.prepare(
      'UPDATE episodes SET description = ?, youtube_description = ? WHERE id = ?'
    ).run(description, description, episodeId);

    log.info({ episodeId, descLength: description.length }, 'Description regenerated');

    return NextResponse.json({ description });
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Description regeneration failed');
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
