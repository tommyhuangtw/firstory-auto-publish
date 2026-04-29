import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { getSearchQueries } from '@/services/pipeline/nodes/fetchYoutube';

export async function GET() {
  return NextResponse.json(getSearchQueries());
}

export async function PUT(req: NextRequest) {
  const body = await req.json() as Record<string, string[]>;

  // Validate structure
  for (const key of ['daily', 'weekly', 'robot']) {
    if (body[key] && !Array.isArray(body[key])) {
      return NextResponse.json({ error: `${key} must be an array` }, { status: 400 });
    }
  }

  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('search_keywords', ?)`
  ).run(JSON.stringify(body));

  return NextResponse.json({ ok: true });
}
