import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

const VALID_STATUSES = ['new', 'developing', 'posted', 'archived'];
const VALID_SOURCE_TYPES = ['text', 'voice', 'link'];

// GET /api/ideas?status=new — list ideas, newest first (optional status filter)
export async function GET(request: NextRequest) {
  const db = getDb();
  const status = request.nextUrl.searchParams.get('status');

  let query = 'SELECT * FROM ideas WHERE 1=1';
  const params: unknown[] = [];

  if (status) {
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC, id DESC';

  const ideas = db.prepare(query).all(...params);
  return NextResponse.json({ ideas });
}

// POST /api/ideas — capture a new idea { content, source_type?, source_url? }
export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json().catch(() => ({}));

  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const source_type = body.source_type ?? 'text';
  const source_url = body.source_url ?? null;

  if (!content) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }
  if (!VALID_SOURCE_TYPES.includes(source_type)) {
    return NextResponse.json({ error: `source_type must be one of: ${VALID_SOURCE_TYPES.join(', ')}` }, { status: 400 });
  }

  const result = db
    .prepare('INSERT INTO ideas (content, source_type, source_url) VALUES (?, ?, ?)')
    .run(content, source_type, source_url);

  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(result.lastInsertRowid);
  return NextResponse.json({ idea }, { status: 201 });
}
