import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { crawlChannel } from '@/services/inspiration/channelCrawler';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:channel-crawl');

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getDb().prepare(
    'SELECT id, channel_id, uploads_playlist_id, title, fetch_count FROM channels WHERE id = ?',
  ).get(Number(id)) as { id: number } | undefined;
  if (!row) return NextResponse.json({ error: 'channel not found' }, { status: 404 });
  crawlChannel(row as never).catch((e) => log.error({ id, err: (e as Error).message }, 'crawl failed'));
  return NextResponse.json({ started: true });
}
