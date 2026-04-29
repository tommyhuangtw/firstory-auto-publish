import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

const TABLE_MAP: Record<string, string> = {
  daily: 'youtube_sources',
  robot: 'robot_youtube_sources',
  weekly: 'weekly_youtube_sources',
};

export async function GET(req: NextRequest) {
  const segment = req.nextUrl.searchParams.get('segment') || 'daily';
  const table = TABLE_MAP[segment];
  if (!table) {
    return NextResponse.json({ error: 'Invalid segment' }, { status: 400 });
  }

  const db = getDb();
  const rows = db.prepare(
    `SELECT id, video_id, title, channel_name, published_at, view_count, like_count, comment_count, used_in_episode, fetched_at
     FROM ${table}
     ORDER BY fetched_at DESC
     LIMIT 200`
  ).all();

  return NextResponse.json(rows);
}
