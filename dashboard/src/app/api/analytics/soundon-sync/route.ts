import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { syncSoundonAnalytics } from '@/services/soundonSync';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('soundon-sync');

// ── POST /api/analytics/soundon-sync ──────────────────────────────────

export async function POST() {
  try {
    const result = await syncSoundonAnalytics();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error({ err: message }, 'SoundOn sync failed');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── GET /api/analytics/soundon-sync (status check) ───────────────────

export async function GET() {
  const db = getDb();

  const lastDaily = db.prepare(
    `SELECT date, downloads, unique_downloads FROM soundon_daily_downloads ORDER BY date DESC LIMIT 1`
  ).get() as { date: string; downloads: number; unique_downloads: number } | undefined;

  const lastEpisode = db.prepare(
    `SELECT title, total_downloads, imported_at FROM soundon_episodes ORDER BY imported_at DESC LIMIT 1`
  ).get() as { title: string; total_downloads: number; imported_at: string } | undefined;

  const dailyCount = (db.prepare(`SELECT count(*) as c FROM soundon_daily_downloads`).get() as { c: number }).c;
  const episodeCount = (db.prepare(`SELECT count(*) as c FROM soundon_episodes`).get() as { c: number }).c;

  return NextResponse.json({
    daily: { count: dailyCount, latest: lastDaily ?? null },
    episodes: { count: episodeCount, latest: lastEpisode ?? null },
  });
}
