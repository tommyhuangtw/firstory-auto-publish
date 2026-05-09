import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

interface AdPreset {
  id: number;
  name: string;
  content: string;
  is_active: number;
}

export async function GET() {
  const db = getDb();
  const presets = db.prepare('SELECT * FROM ad_presets ORDER BY is_active DESC, id ASC').all() as AdPreset[];
  return NextResponse.json(presets);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { name, content } = body as { name?: string; content?: string };

  if (!name || typeof content !== 'string') {
    return NextResponse.json({ error: 'name and content are required' }, { status: 400 });
  }

  const db = getDb();
  const result = db.prepare('INSERT INTO ad_presets (name, content) VALUES (?, ?)').run(name, content);
  return NextResponse.json({ id: result.lastInsertRowid, name, content });
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { id, action, name, content } = body as { id?: number; action?: string; name?: string; content?: string };

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const db = getDb();

  if (action === 'activate') {
    db.prepare('UPDATE ad_presets SET is_active = 0').run();
    db.prepare('UPDATE sponsor_audio_presets SET is_active = 0').run();
    db.prepare('UPDATE ad_presets SET is_active = 1 WHERE id = ?').run(id);
    return NextResponse.json({ message: 'activated' });
  }

  if (action === 'deactivate') {
    db.prepare('UPDATE ad_presets SET is_active = 0 WHERE id = ?').run(id);
    return NextResponse.json({ message: 'deactivated' });
  }

  if (name !== undefined || content !== undefined) {
    if (name !== undefined) db.prepare('UPDATE ad_presets SET name = ? WHERE id = ?').run(name, id);
    if (content !== undefined) db.prepare('UPDATE ad_presets SET content = ? WHERE id = ?').run(content, id);
    return NextResponse.json({ message: 'updated' });
  }

  return NextResponse.json({ error: 'No action specified' }, { status: 400 });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  db.prepare('DELETE FROM ad_presets WHERE id = ?').run(parseInt(id));
  return NextResponse.json({ message: 'deleted' });
}
