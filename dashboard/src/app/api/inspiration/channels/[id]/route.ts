import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

/** Body: { active?: boolean, fetchCount?: number } */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const db = getDb();
  if (typeof body.active === 'boolean') db.prepare('UPDATE channels SET active = ? WHERE id = ?').run(body.active ? 1 : 0, Number(id));
  if (typeof body.fetchCount === 'number') {
    const fc = Math.max(1, Math.min(50, Math.floor(body.fetchCount))); // Data API caps maxResults at 50
    db.prepare('UPDATE channels SET fetch_count = ? WHERE id = ?').run(fc, Number(id));
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  getDb().prepare('DELETE FROM channels WHERE id = ?').run(Number(id));
  return NextResponse.json({ ok: true });
}
