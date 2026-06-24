import { NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET() {
  const themes = getDb().prepare(
    'SELECT id, name, description, insight_count FROM inspiration_themes ORDER BY insight_count DESC, id',
  ).all();
  return NextResponse.json({ themes });
}
