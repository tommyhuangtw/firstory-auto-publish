import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const episodeId = parseInt(id);
  if (isNaN(episodeId)) {
    return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { scriptZh, scriptEn } = body as { scriptZh?: string; scriptEn?: string };

    if (!scriptZh && !scriptEn) {
      return NextResponse.json({ error: 'scriptZh or scriptEn required' }, { status: 400 });
    }

    const db = getDb();

    if (scriptZh !== undefined) {
      db.prepare('UPDATE episodes SET script_zh = ? WHERE id = ?')
        .run(scriptZh, episodeId);
    }
    if (scriptEn !== undefined) {
      db.prepare('UPDATE episodes SET script_en = ? WHERE id = ?')
        .run(scriptEn, episodeId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
