import { NextResponse } from 'next/server';
import { crawlAllActive } from '@/services/inspiration/channelCrawler';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:channel-crawl-all');

export async function POST() {
  crawlAllActive().catch((e) => log.error({ err: (e as Error).message }, 'crawl-all failed'));
  return NextResponse.json({ started: true });
}
