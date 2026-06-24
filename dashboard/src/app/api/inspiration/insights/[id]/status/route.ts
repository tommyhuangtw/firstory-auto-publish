import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

/** Body: { status: 'saved' | 'hidden' | 'new' } */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const status = body.status;
  if (!['saved', 'hidden', 'new'].includes(status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  getDb().prepare('UPDATE insights SET status = ? WHERE id = ?').run(status, Number(id));
  return NextResponse.json({ ok: true, id: Number(id), status });
}
