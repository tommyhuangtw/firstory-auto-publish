import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { regenerateTitles } from '@/services/pipeline/nodes/generateMeta';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:regenerate-titles');

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
    const userPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : undefined;

    const db = getDb();
    const episode = db.prepare(
      'SELECT segment_type, script_zh, script_en FROM episodes WHERE id = ?'
    ).get(episodeId) as { segment_type: string; script_zh: string | null; script_en: string | null } | undefined;

    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    const scriptContent = episode.script_zh || episode.script_en || '';
    if (!scriptContent) {
      return NextResponse.json({ error: 'No script content available' }, { status: 400 });
    }

    log.info({ episodeId, segmentType: episode.segment_type, hasUserPrompt: !!userPrompt }, 'Regenerating titles');

    const { candidateTitles, selectedTitle } = await regenerateTitles(
      episode.segment_type,
      scriptContent,
      episodeId,
      userPrompt || undefined,
    );

    db.prepare(
      'UPDATE episodes SET candidate_titles = ?, selected_title = ? WHERE id = ?'
    ).run(JSON.stringify(candidateTitles), selectedTitle, episodeId);

    log.info({ episodeId, count: candidateTitles.length, selectedTitle: selectedTitle.slice(0, 50) }, 'Titles regenerated');

    return NextResponse.json({ candidateTitles, selectedTitle });
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Title regeneration failed');
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
