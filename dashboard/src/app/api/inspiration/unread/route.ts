import { NextResponse } from 'next/server';
import { getDb } from '@/db';

// Sidebar red dot for 靈感庫: counts insights ingested since the user last opened the library.
// Mirrors the trends reply-zone unread mechanism (settings last-seen + count newer rows).
const SEEN_KEY = 'inspiration_last_seen';

export async function GET() {
  const db = getDb();
  const lastSeen = (db.prepare('SELECT value FROM settings WHERE key = ?').get(SEEN_KEY) as
    { value: string } | undefined)?.value || '1970-01-01';
  // Bound to the last 14 days so a never-opened library (1970 default) doesn't flood the dot;
  // genuinely-new crawl insights are recent and always fall inside this window.
  const row = db.prepare(`
    SELECT COUNT(*) AS n
    FROM insights
    WHERE status != 'hidden'
      AND created_at > datetime('now', '-14 days')
      AND created_at > ?
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
