import { NextRequest, NextResponse } from 'next/server';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:trends-scan');

/**
 * Trigger a trend scan. Fire-and-forget: scraping a browser session takes a while,
 * so we kick it off in the background and return immediately. Results land in
 * trend_topics / trend_drafts and are pushed via the digest.
 */
export async function POST(request: NextRequest) {
  let maxPosts: number | undefined;
  try {
    const body = await request.json();
    if (typeof body?.maxPosts === 'number') maxPosts = body.maxPosts;
  } catch { /* empty body is fine */ }

  const { runTrendScan } = await import('@/services/trends/pipeline');

  runTrendScan({ maxPosts })
    .then((r) => log.info(r, 'Background trend scan complete'))
    .catch((e) => log.error({ err: (e as Error).message }, 'Background trend scan failed'));

  return NextResponse.json({ started: true, message: '社群熱點掃描已啟動（背景執行）' });
}
