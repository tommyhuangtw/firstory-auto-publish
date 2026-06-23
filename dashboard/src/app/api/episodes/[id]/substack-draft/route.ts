import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { generateDraftForEpisode, getDraftByEpisode } from '@/services/substackDraftService';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:substack-draft');

// GET: return the current draft for this episode (or null)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const episodeId = parseInt(id);
  if (isNaN(episodeId)) {
    return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
  }
  return NextResponse.json({ draft: getDraftByEpisode(episodeId) });
}

// POST: generate (or regenerate) the draft for this episode
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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

    const draft = await generateDraftForEpisode(episodeId);
    log.info({ episodeId, draftId: draft.id }, 'Generated Substack draft via API');
    return NextResponse.json({ draft });
  } catch (err) {
    const message = (err as Error).message;
    log.error({ error: message }, 'Substack draft generation failed');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
