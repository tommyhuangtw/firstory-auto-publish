import { NextResponse } from 'next/server';
import { getDb } from '@/db';

// Sidebar red dot for 選題板: count candidates crawled since the user last opened it.
const SEEN_KEY = 'candidates_last_seen';

export async function GET() {
  const db = getDb();
  const lastSeen = (db.prepare('SELECT value FROM settings WHERE key = ?').get(SEEN_KEY) as
    { value: string } | undefined)?.value || '1970-01-01';
  // Bound to 14 days so a never-opened board doesn't flood the dot with the default 1970.
  const row = db.prepare(`
    SELECT COUNT(*) AS n
    FROM episode_candidates
    WHERE status = 'new'
      AND crawled_at > datetime('now', '-14 days')
      AND crawled_at > ?
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
