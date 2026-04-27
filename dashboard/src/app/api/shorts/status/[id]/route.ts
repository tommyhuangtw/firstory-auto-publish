import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const shortsId = parseInt(id);
  if (isNaN(shortsId)) {
    return NextResponse.json({ error: 'Invalid shorts ID' }, { status: 400 });
  }

  const db = getDb();
  const shorts = db.prepare(
    `SELECT id, episode_number, status, current_stage, error_log,
            video_path, cover_path, ig_caption, ig_post_id,
            beats_json, selected_beat_index, headlines_json, selected_headline_index,
            created_at, completed_at
     FROM shorts WHERE id = ?`
  ).get(shortsId);

  if (!shorts) {
    return NextResponse.json({ error: 'Shorts not found' }, { status: 404 });
  }

  return NextResponse.json(shorts);
}
