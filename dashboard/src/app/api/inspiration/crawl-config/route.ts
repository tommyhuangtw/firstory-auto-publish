import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { getInspirationCrawlConfig, applyInspirationCrawlConfig } from '@/lib/schedulerInit';

/** Derive a daily HH:MM from a `M H * * *` cron, or null if it isn't a simple daily schedule. */
function cronToTime(cron: string): string | null {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5 || p[2] !== '*' || p[3] !== '*' || p[4] !== '*') return null;
  const m = Number(p[0]); const h = Number(p[1]);
  if (!Number.isInteger(m) || !Number.isInteger(h) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export async function GET() {
  const cfg = getInspirationCrawlConfig();
  return NextResponse.json({ enabled: cfg.enabled, cron: cfg.cron, time: cronToTime(cfg.cron) });
}

/** Body: { enabled?: boolean, time?: 'HH:MM' }. Persists settings + applies to the live scheduler. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const db = getDb();
  const setSetting = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );

  if (typeof body.enabled === 'boolean') {
    setSetting.run('inspiration_crawl_enabled', body.enabled ? '1' : '0');
  }
  if (typeof body.time === 'string') {
    const m = body.time.match(/^(\d{1,2}):(\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
      return NextResponse.json({ error: '時間格式需為 HH:MM' }, { status: 400 });
    }
    setSetting.run('inspiration_crawl_schedule', `${Number(m[2])} ${Number(m[1])} * * *`);
  }

  try {
    const cfg = applyInspirationCrawlConfig();
    return NextResponse.json({ enabled: cfg.enabled, cron: cfg.cron, time: cronToTime(cfg.cron) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
