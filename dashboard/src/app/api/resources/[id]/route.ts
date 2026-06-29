import { NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json() as { action?: 'dismiss'; draftText?: string; draftId?: number };
  const db = getDb();
  if (body.action === 'dismiss') {
    db.prepare("UPDATE curated_resources SET status = 'dismissed' WHERE id = ?").run(id);
    return NextResponse.json({ ok: true });
  }
  if (typeof body.draftText === 'string' && body.draftId) {
    db.prepare('UPDATE resource_drafts SET draft_text = ? WHERE id = ?').run(body.draftText, body.draftId);
  }
  return NextResponse.json({ ok: true });
}
