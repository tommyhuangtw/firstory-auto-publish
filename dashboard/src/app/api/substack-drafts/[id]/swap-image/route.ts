import { NextRequest, NextResponse } from 'next/server';
import { swapDraftImage } from '@/services/substackDraftService';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:substack-swap-image');

// POST: swap one image for a different Unsplash candidate.
// Body: { imageUrl: string, query?: string }
//  - imageUrl: the current image URL to replace
//  - query: optional new search keywords (else cycles to the next candidate)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const draftId = parseInt(id);
    if (isNaN(draftId)) {
      return NextResponse.json({ error: 'Invalid draft id' }, { status: 400 });
    }
    const body = await request.json();
    const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl : '';
    const query = typeof body?.query === 'string' ? body.query : undefined;
    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 });
    }

    const draft = await swapDraftImage(draftId, imageUrl, query);
    log.info({ draftId }, 'Swapped Substack draft image via API');
    return NextResponse.json({ draft });
  } catch (err) {
    const message = (err as Error).message;
    log.error({ error: message }, 'Substack image swap failed');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
