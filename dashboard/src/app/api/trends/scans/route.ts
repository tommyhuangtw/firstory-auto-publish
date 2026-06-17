import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

/** List recent crawl runs (audit log). Summary only — funnel counts + topics + timing;
 *  the per-post dropped detail lives in the [id] detail route. ?limit (default 30). */
export async function GET(request: NextRequest) {
  const db = getDb();
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '30', 10), 60);
  const runs = (db.prepare(
    `SELECT id, started_at, finished_at, duration_ms, trigger, topics,
            scraped, below_floor, stale, deduped, recorded, error
     FROM trend_scan_runs ORDER BY id DESC LIMIT ?`,
  ).all(limit) as Array<Record<string, unknown> & { topics: string | null }>).map((r) => ({
    ...r,
    topics: r.topics ? safeParse(r.topics) : [],
  }));
  return NextResponse.json({ runs });
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return []; }
}
