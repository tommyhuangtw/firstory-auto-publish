import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const episodeNumber = parseInt(id);
  if (isNaN(episodeNumber)) {
    return NextResponse.json({ error: 'Invalid episode number' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { scriptZh, scriptEn } = body as { scriptZh?: string; scriptEn?: string };

    if (!scriptZh && !scriptEn) {
      return NextResponse.json({ error: 'scriptZh or scriptEn required' }, { status: 400 });
    }

    const db = getDb();

    if (scriptZh !== undefined) {
      db.prepare('UPDATE episodes SET script_zh = ? WHERE episode_number = ?')
        .run(scriptZh, episodeNumber);
    }
    if (scriptEn !== undefined) {
      db.prepare('UPDATE episodes SET script_en = ? WHERE episode_number = ?')
        .run(scriptEn, episodeNumber);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
