import { NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET() {
  const db = getDb();
  const row = db.prepare("SELECT count(*) AS c FROM resource_drafts WHERE status = 'new'").get() as { c: number };
  return NextResponse.json({ unread: row.c });
}
