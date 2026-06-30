import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

const VALID_STATUSES = ['new', 'developing', 'posted', 'archived'];

// PATCH /api/ideas/:id — update content / status / posted_url
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const existing = db.prepare('SELECT * FROM ideas WHERE id = ?').get(id);
  if (!existing) {
    return NextResponse.json({ error: 'idea not found' }, { status: 404 });
  }

  const sets: string[] = [];
  const values: unknown[] = [];

  if (typeof body.content === 'string') {
    const content = body.content.trim();
    if (!content) {
      return NextResponse.json({ error: 'content cannot be empty' }, { status: 400 });
    }
    sets.push('content = ?');
    values.push(content);
  }

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }
    sets.push('status = ?');
    values.push(body.status);
  }

  if (body.posted_url !== undefined) {
    sets.push('posted_url = ?');
    values.push(body.posted_url || null);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'no updatable fields provided' }, { status: 400 });
  }

  sets.push("updated_at = datetime('now')");
  db.prepare(`UPDATE ideas SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);

  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(id);
  return NextResponse.json({ idea });
}

// DELETE /api/ideas/:id
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const { id } = await params;

  const result = db.prepare('DELETE FROM ideas WHERE id = ?').run(id);
  if (result.changes === 0) {
    return NextResponse.json({ error: 'idea not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
