import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value, updated_at FROM settings').all() as { key: string; value: string; updated_at: string }[];
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;
  return NextResponse.json(settings);
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { key, value } = body as { key?: string; value?: string };

  if (!key || typeof value !== 'string') {
    return NextResponse.json({ error: 'key and value are required' }, { status: 400 });
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value);

  return NextResponse.json({ key, value, message: 'saved' });
}
