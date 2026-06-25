import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { writeThreadsPost } from '@/services/voice/writer';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:inspiration-draft');

interface InsightRow { id: number; hook: string; idea: string; why_share: string | null; }

/** Body: { userNote?, useStories? }. Writes a Threads draft in Tommy's voice from the insight. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const userNote: string | undefined = typeof body.userNote === 'string' && body.userNote.trim() ? body.userNote : undefined;
  const useStories = !!body.useStories;
  const db = getDb();
  const insight = db.prepare('SELECT id, hook, idea, why_share FROM insights WHERE id = ?').get(Number(id)) as InsightRow | undefined;
  if (!insight) return NextResponse.json({ error: 'insight not found' }, { status: 404 });
  try {
    // The insight (+ optional note) becomes the mindset; the voice writer extends
    // it in Tommy's tone (style profile only, no copying his old posts).
    const mindset = `${insight.hook}\n${insight.idea}${insight.why_share ? `\n${insight.why_share}` : ''}`
      + (userNote ? `\n\n我自己想補充的角度:${userNote}` : '');
    const { draft: draftText } = await writeThreadsPost({ mode: 'rewrite', idea: mindset, useStories });
    const d = db.prepare(
      `INSERT INTO insight_drafts (insight_id, user_note, draft_text, platform, status) VALUES (?, ?, ?, 'threads', 'pending_review')`,
    ).run(insight.id, userNote || null, draftText);
    return NextResponse.json({ draftId: Number(d.lastInsertRowid), draft_text: draftText });
  } catch (err) {
    log.error({ id, err: (err as Error).message }, 'draft failed');
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
