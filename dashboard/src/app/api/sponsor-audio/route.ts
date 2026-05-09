import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs-extra';
import path from 'path';
import { getDb } from '@/db';

interface SponsorPreset {
  id: number;
  name: string;
  script_text: string;
  audio_path: string;
  audio_duration_sec: number | null;
  is_active: number;
  expires_at: string | null;
  created_at: string;
}

export async function GET() {
  const db = getDb();
  const presets = db.prepare(
    'SELECT * FROM sponsor_audio_presets ORDER BY is_active DESC, id DESC'
  ).all() as SponsorPreset[];

  const now = new Date().toISOString();
  const result = presets.map(p => ({
    ...p,
    expired: p.expires_at ? p.expires_at <= now : false,
  }));

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { name, scriptText, audioPath, durationSec, expiresInDays } = body as {
    name?: string;
    scriptText?: string;
    audioPath?: string;
    durationSec?: number;
    expiresInDays?: number;
  };

  if (!name?.trim() || !scriptText?.trim() || !audioPath) {
    return NextResponse.json(
      { error: 'name, scriptText, and audioPath are required' },
      { status: 400 }
    );
  }

  // Copy test audio to permanent location
  const permanentDir = path.join(process.cwd(), '..', 'temp', 'tts', 'sponsor_presets');
  await fs.ensureDir(permanentDir);
  const ext = path.extname(audioPath) || '.mp3';
  const permanentPath = path.join(permanentDir, `sponsor_${Date.now()}${ext}`);
  await fs.copy(audioPath, permanentPath);

  let expiresAt: string | null = null;
  if (expiresInDays && expiresInDays > 0) {
    const d = new Date();
    d.setDate(d.getDate() + expiresInDays);
    expiresAt = d.toISOString();
  }

  const db = getDb();
  const result = db.prepare(
    'INSERT INTO sponsor_audio_presets (name, script_text, audio_path, audio_duration_sec, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(name.trim(), scriptText.trim(), permanentPath, durationSec ?? null, expiresAt);

  return NextResponse.json({
    id: result.lastInsertRowid,
    name: name.trim(),
    script_text: scriptText.trim(),
    audio_path: permanentPath,
    audio_duration_sec: durationSec ?? null,
    is_active: 0,
    expires_at: expiresAt,
  });
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { id, action } = body as { id?: number; action?: string };

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const db = getDb();

  if (action === 'activate') {
    db.prepare('UPDATE sponsor_audio_presets SET is_active = 0').run();
    db.prepare('UPDATE sponsor_audio_presets SET is_active = 1 WHERE id = ?').run(id);
    return NextResponse.json({ message: 'activated' });
  }

  if (action === 'deactivate') {
    db.prepare('UPDATE sponsor_audio_presets SET is_active = 0 WHERE id = ?').run(id);
    return NextResponse.json({ message: 'deactivated' });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  const preset = db.prepare('SELECT audio_path FROM sponsor_audio_presets WHERE id = ?').get(parseInt(id)) as { audio_path: string } | undefined;

  if (preset?.audio_path) {
    await fs.remove(preset.audio_path).catch(() => {});
  }

  db.prepare('DELETE FROM sponsor_audio_presets WHERE id = ?').run(parseInt(id));
  return NextResponse.json({ message: 'deleted' });
}
