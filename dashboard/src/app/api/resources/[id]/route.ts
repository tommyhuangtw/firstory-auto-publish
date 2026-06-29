import { NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json() as { draftText?: string; action?: 'dismiss' };
  const db = getDb();
  if (body.action === 'dismiss') {
    db.prepare('UPDATE resource_drafts SET status = ? WHERE id = ?').run('dismissed', id);
    return NextResponse.json({ ok: true });
  }
  if (typeof body.draftText === 'string') {
    db.prepare('UPDATE resource_drafts SET draft_text = ? WHERE id = ?').run(body.draftText, id);
  }
  return NextResponse.json({ ok: true });
}
