import { NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET() {
  const db = getDb();
  const seen = (db.prepare("SELECT value FROM settings WHERE key = 'resource_last_seen'").get() as { value: string } | undefined)?.value ?? '1970-01-01';
  const c = (db.prepare("SELECT count(*) AS c FROM curated_resources WHERE status='surfaced' AND last_surfaced_at > ?").get(seen) as { c: number }).c;
  return NextResponse.json({ unread: c });
}

export async function POST() {
  const db = getDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('resource_last_seen', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(new Date().toISOString());
  return NextResponse.json({ ok: true });
}
