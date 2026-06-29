import { NextResponse } from 'next/server';
import { getDb } from '@/db';

const SEEN_KEY = 'thumbnail_review_last_seen';

export async function GET() {
  const db = getDb();
  const lastSeen = (db.prepare('SELECT value FROM settings WHERE key = ?').get(SEEN_KEY) as
    { value: string } | undefined)?.value || '1970-01-01';
  // Count AI-generated styles still pending review (is_enabled=0) that appeared since the
  // user last opened the page. Bounded to 30 days so a never-opened page (1970 default)
  // doesn't flood the dot with old pending styles; the biweekly job's output is always recent.
  const row = db.prepare(`
    SELECT COUNT(*) AS n
    FROM thumbnail_styles
    WHERE source = 'generated'
      AND is_enabled = 0
      AND generated_at IS NOT NULL
      AND datetime(generated_at) > datetime('now', '-30 days')
      AND datetime(generated_at) > datetime(?)
  `).get(lastSeen) as { n: number };
  return NextResponse.json({ count: row.n });
}

export async function POST() {
  getDb().prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, datetime('now'), datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = datetime('now'), updated_at = datetime('now')
  `).run(SEEN_KEY);
  return NextResponse.json({ ok: true });
}
