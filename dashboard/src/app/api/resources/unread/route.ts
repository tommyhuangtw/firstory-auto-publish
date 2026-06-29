import { NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET() {
  const db = getDb();
  const row = db.prepare("SELECT count(*) AS c FROM resource_drafts WHERE status = 'new'").get() as { c: number };
  return NextResponse.json({ unread: row.c });
}

export async function POST() {
  const db = getDb();
  db.prepare("UPDATE resource_drafts SET status = 'seen' WHERE status = 'new'").run();
  return NextResponse.json({ ok: true });
}
