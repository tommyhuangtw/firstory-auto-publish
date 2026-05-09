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
  ad_preset_id: number | null;
  created_at: string;
}

export async function GET() {
  const db = getDb();
  const presets = db.prepare(`
    SELECT s.*, a.content AS ad_content
    FROM sponsor_audio_presets s
    LEFT JOIN ad_presets a ON s.ad_preset_id = a.id
    ORDER BY s.is_active DESC, s.id DESC
  `).all() as (SponsorPreset & { ad_content: string | null })[];

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const result = presets.map(p => {
    // Check if all scheduled dates are in the past
    let expired = false;
    if (p.scheduled_dates) {
      const dates: string[] = JSON.parse(p.scheduled_dates as unknown as string);
      expired = dates.length > 0 && dates.every(d => d < today);
    } else if (p.expires_at) {
      expired = p.expires_at <= now;
    }
    return { ...p, expired };
  });

  // Also return ad_presets that aren't linked to any sponsor_audio_preset
  const unlinkedAds = db.prepare(`
    SELECT a.* FROM ad_presets a
    WHERE a.id NOT IN (
      SELECT ad_preset_id FROM sponsor_audio_presets WHERE ad_preset_id IS NOT NULL
    )
    ORDER BY a.is_active DESC, a.id ASC
  `).all() as { id: number; name: string; content: string; is_active: number }[];

  return NextResponse.json({ presets: result, unlinkedAds });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { name, scriptText, audioPath, durationSec, scheduledDates, adContent } = body as {
    name?: string;
    scriptText?: string;
    audioPath?: string;
    durationSec?: number;
    scheduledDates?: string[];
    adContent?: string;
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

  const scheduledDatesJson = scheduledDates?.length ? JSON.stringify(scheduledDates) : null;

  const db = getDb();

  // Create linked ad_preset
  const adResult = db.prepare(
    'INSERT INTO ad_presets (name, content) VALUES (?, ?)'
  ).run(name.trim(), (adContent ?? '').trim());
  const adPresetId = adResult.lastInsertRowid;

  const result = db.prepare(
    'INSERT INTO sponsor_audio_presets (name, script_text, audio_path, audio_duration_sec, scheduled_dates, ad_preset_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name.trim(), scriptText.trim(), permanentPath, durationSec ?? null, scheduledDatesJson, adPresetId);

  return NextResponse.json({
    id: result.lastInsertRowid,
    name: name.trim(),
    script_text: scriptText.trim(),
    audio_path: permanentPath,
    audio_duration_sec: durationSec ?? null,
    is_active: 0,
    scheduled_dates: scheduledDatesJson,
    ad_preset_id: adPresetId,
    ad_content: (adContent ?? '').trim(),
  });
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { id, action, adContent, scheduledDates } = body as { id?: number; action?: string; adContent?: string; scheduledDates?: string[] | null };

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const db = getDb();

  // Get the sponsor preset to find linked ad_preset_id
  const sponsor = db.prepare(
    'SELECT ad_preset_id FROM sponsor_audio_presets WHERE id = ?'
  ).get(id) as { ad_preset_id: number | null } | undefined;

  if (action === 'activate') {
    // Deactivate all sponsors and all ad_presets
    db.prepare('UPDATE sponsor_audio_presets SET is_active = 0').run();
    db.prepare('UPDATE ad_presets SET is_active = 0').run();
    // Activate this sponsor and its linked ad_preset
    db.prepare('UPDATE sponsor_audio_presets SET is_active = 1 WHERE id = ?').run(id);
    if (sponsor?.ad_preset_id) {
      db.prepare('UPDATE ad_presets SET is_active = 1 WHERE id = ?').run(sponsor.ad_preset_id);
    }
    return NextResponse.json({ message: 'activated' });
  }

  if (action === 'deactivate') {
    db.prepare('UPDATE sponsor_audio_presets SET is_active = 0 WHERE id = ?').run(id);
    if (sponsor?.ad_preset_id) {
      db.prepare('UPDATE ad_presets SET is_active = 0 WHERE id = ?').run(sponsor.ad_preset_id);
    }
    return NextResponse.json({ message: 'deactivated' });
  }

  if (action === 'toggle_audio_merge') {
    db.prepare(
      'UPDATE sponsor_audio_presets SET audio_merge_enabled = CASE WHEN audio_merge_enabled = 1 THEN 0 ELSE 1 END WHERE id = ?'
    ).run(id);
    const updated = db.prepare('SELECT audio_merge_enabled FROM sponsor_audio_presets WHERE id = ?').get(id) as { audio_merge_enabled: number };
    return NextResponse.json({ message: 'toggled', audio_merge_enabled: updated.audio_merge_enabled });
  }

  if (action === 'update_schedule') {
    const json = scheduledDates?.length ? JSON.stringify(scheduledDates) : null;
    db.prepare('UPDATE sponsor_audio_presets SET scheduled_dates = ? WHERE id = ?').run(json, id);
    return NextResponse.json({ message: 'schedule updated', scheduled_dates: json });
  }

  // Update ad content
  if (adContent !== undefined && sponsor?.ad_preset_id) {
    db.prepare('UPDATE ad_presets SET content = ? WHERE id = ?').run(adContent.trim(), sponsor.ad_preset_id);
    return NextResponse.json({ message: 'ad content updated' });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  const preset = db.prepare(
    'SELECT audio_path, ad_preset_id FROM sponsor_audio_presets WHERE id = ?'
  ).get(parseInt(id)) as { audio_path: string; ad_preset_id: number | null } | undefined;

  if (preset?.audio_path) {
    await fs.remove(preset.audio_path).catch(() => {});
  }

  db.prepare('DELETE FROM sponsor_audio_presets WHERE id = ?').run(parseInt(id));

  // Delete linked ad_preset
  if (preset?.ad_preset_id) {
    db.prepare('DELETE FROM ad_presets WHERE id = ?').run(preset.ad_preset_id);
  }

  return NextResponse.json({ message: 'deleted' });
}
