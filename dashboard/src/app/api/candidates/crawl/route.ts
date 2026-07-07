import { NextResponse } from 'next/server';
import { crawlAll } from '@/services/candidateCrawler';

// Manually trigger a candidate crawl (awaited — a single crawl is ~seconds to <1min).
export async function POST() {
  try {
    const result = await crawlAll();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
