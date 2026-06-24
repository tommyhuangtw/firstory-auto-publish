import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { resolveChannel, addChannel } from '@/services/inspiration/channelCrawler';

/** List channels with an ingested-count per channel. */
export async function GET() {
  const db = getDb();
  const channels = db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM content_summaries cs WHERE cs.channel_id = c.id) AS ingested_count
     FROM channels c ORDER BY c.created_at DESC`,
  ).all();
  return NextResponse.json({ channels });
}

/** Add a channel by URL. Body: { url: string, fetchCount?: number }. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (!body.url || typeof body.url !== 'string') return NextResponse.json({ error: 'url required' }, { status: 400 });
  try {
    const c = await resolveChannel(body.url);
    addChannel(c, typeof body.fetchCount === 'number' ? body.fetchCount : 5);
    const row = getDb().prepare('SELECT * FROM channels WHERE channel_id = ?').get(c.channelId);
    return NextResponse.json({ channel: row });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
