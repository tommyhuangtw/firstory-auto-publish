import { NextRequest, NextResponse } from 'next/server';
import { getDraftById, updateDraft } from '@/services/substackDraftService';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:substack-drafts');

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const draftId = parseInt(id);
  if (isNaN(draftId)) {
    return NextResponse.json({ error: 'Invalid draft id' }, { status: 400 });
  }
  const draft = getDraftById(draftId);
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  return NextResponse.json({ draft });
}

// PATCH: save edited fields. Body may include any of:
// seoTitle, deck, seoDescription, coverImageUrl, bodyMarkdown, audioUrl, status
export async function PATCH(
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
    const allowed = ['seoTitle', 'deck', 'seoDescription', 'coverImageUrl', 'bodyMarkdown', 'audioUrl', 'status'] as const;
    const fields: Record<string, unknown> = {};
    for (const k of allowed) {
      if (typeof body?.[k] === 'string') fields[k] = body[k];
    }
    const draft = updateDraft(draftId, fields);
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    log.info({ draftId, fields: Object.keys(fields) }, 'Updated Substack draft');
    return NextResponse.json({ draft });
  } catch (err) {
    const message = (err as Error).message;
    log.error({ error: message }, 'Substack draft update failed');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
