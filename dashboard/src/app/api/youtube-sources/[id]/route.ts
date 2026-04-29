import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

const TABLE_MAP: Record<string, string> = {
  daily: 'youtube_sources',
  robot: 'robot_youtube_sources',
  weekly: 'weekly_youtube_sources',
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const table = TABLE_MAP[body.segment || 'daily'];
  if (!table) {
    return NextResponse.json({ error: 'Invalid segment' }, { status: 400 });
  }

  const db = getDb();
  db.prepare(`UPDATE ${table} SET used_in_episode = NULL WHERE id = ?`).run(id);

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const segment = req.nextUrl.searchParams.get('segment') || 'daily';
  const table = TABLE_MAP[segment];
  if (!table) {
    return NextResponse.json({ error: 'Invalid segment' }, { status: 400 });
  }

  const db = getDb();
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);

  return NextResponse.json({ ok: true });
}
