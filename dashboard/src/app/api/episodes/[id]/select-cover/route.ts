import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const episodeId = parseInt(id);
  if (isNaN(episodeId)) {
    return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
  }

  const body = await request.json();
  const { index } = body as { index: number };
  if (typeof index !== 'number' || index < 0) {
    return NextResponse.json({ error: 'Invalid candidate index' }, { status: 400 });
  }

  const db = getDb();
  const row = db.prepare('SELECT cover_candidates FROM episodes WHERE id = ?').get(episodeId) as { cover_candidates: string | null } | undefined;
  if (!row) {
    return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
  }

  const candidates: { path: string; url: string }[] = row.cover_candidates ? JSON.parse(row.cover_candidates) : [];
  if (index >= candidates.length) {
    return NextResponse.json({ error: 'Candidate index out of range' }, { status: 400 });
  }

  const selected = candidates[index];
  db.prepare('UPDATE episodes SET cover_path = ?, cover_url = ? WHERE id = ?')
    .run(selected.path, selected.url || null, episodeId);

  return NextResponse.json({ coverPath: selected.path, coverUrl: selected.url });
}
