import { NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET() {
  const db = getDb();
  const runs = db.prepare('SELECT * FROM resource_scan_runs ORDER BY id DESC LIMIT 10').all();
  return NextResponse.json({ runs });
}
