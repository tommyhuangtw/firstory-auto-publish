import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET(request: NextRequest) {
  const db = getDb();
  const { searchParams } = request.nextUrl;

  const status = searchParams.get('status');
  const segment = searchParams.get('segment');
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = parseInt(searchParams.get('offset') || '0');

  let query = 'SELECT * FROM episodes WHERE 1=1';
  const params: unknown[] = [];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (segment) {
    query += ' AND segment_type = ?';
    params.push(segment);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const episodes = db.prepare(query).all(...params);
  const total = db
    .prepare('SELECT count(*) as count FROM episodes')
    .get() as { count: number };

  return NextResponse.json({ episodes, total: total.count });
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json();

  const { episode_number, segment_type } = body;
  if (!episode_number || !segment_type) {
    return NextResponse.json(
      { error: 'episode_number and segment_type are required' },
      { status: 400 }
    );
  }

  const result = db
    .prepare('INSERT INTO episodes (episode_number, segment_type) VALUES (?, ?)')
    .run(episode_number, segment_type);

  return NextResponse.json(
    { id: result.lastInsertRowid, episode_number, segment_type, status: 'generating' },
    { status: 201 }
  );
}
