import { NextResponse } from 'next/server';
import { getDb } from '@/db';

const SEEN_KEY = 'trends_reply_last_seen';

/** How many reply-zone (niche) posts are newer than the last time the user opened the tab. */
export async function GET() {
  const db = getDb();
  const lastSeen = (db.prepare('SELECT value FROM settings WHERE key = ?').get(SEEN_KEY) as
    { value: string } | undefined)?.value || '1970-01-01';
  const row = db.prepare(`
    SELECT COUNT(*) AS n
    FROM trend_posts
    WHERE niche = 1
      AND scraped_at > datetime('now', '-3 days')
      AND scraped_at > ?
  `).get(lastSeen) as { n: number };
  return NextResponse.json({ count: row.n });
}

/** Mark the reply zone as seen (call when the user opens the 回覆專區 tab). */
export async function POST() {
  getDb().prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, datetime('now'), datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = datetime('now'), updated_at = datetime('now')
  `).run(SEEN_KEY);
  return NextResponse.json({ ok: true });
}
