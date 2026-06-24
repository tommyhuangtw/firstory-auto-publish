import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { writeInsightPost } from '@/services/inspiration/draftWriter';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:inspiration-draft');

interface InsightRow { id: number; hook: string; idea: string; why_share: string | null; }

/** Body: { userNote?: string }. Generates a Threads draft and stores it. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const userNote: string | undefined = typeof body.userNote === 'string' && body.userNote.trim() ? body.userNote : undefined;
  const db = getDb();
  const insight = db.prepare('SELECT id, hook, idea, why_share FROM insights WHERE id = ?').get(Number(id)) as InsightRow | undefined;
  if (!insight) return NextResponse.json({ error: 'insight not found' }, { status: 404 });
  try {
    const draftText = await writeInsightPost(insight, userNote);
    const d = db.prepare(
      `INSERT INTO insight_drafts (insight_id, user_note, draft_text, platform, status) VALUES (?, ?, ?, 'threads', 'pending_review')`,
    ).run(insight.id, userNote || null, draftText);
    return NextResponse.json({ draftId: Number(d.lastInsertRowid), draft_text: draftText });
  } catch (err) {
    log.error({ id, err: (err as Error).message }, 'draft failed');
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
