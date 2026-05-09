import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { getDb } from '@/db';
import { concatMp3s, generateSilence, probeDuration } from '@/services/pipeline/nodes/tts';

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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const episodeId = parseInt(id);
  const db = getDb();

  const episode = db.prepare(
    'SELECT sponsor_audio_id, sponsor_original_audio_path FROM episodes WHERE id = ?'
  ).get(episodeId) as { sponsor_audio_id: number | null; sponsor_original_audio_path: string | null } | undefined;

  if (!episode) {
    return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const presets = db.prepare(
    'SELECT * FROM sponsor_audio_presets ORDER BY is_active DESC, id DESC'
  ).all() as SponsorPreset[];

  const availablePresets = presets.map(p => ({
    id: p.id,
    name: p.name,
    audio_duration_sec: p.audio_duration_sec,
    is_active: p.is_active,
    expires_at: p.expires_at,
    expired: p.expires_at ? p.expires_at <= now : false,
  }));

  return NextResponse.json({
    sponsorAudioId: episode.sponsor_audio_id,
    hasOriginalAudio: !!episode.sponsor_original_audio_path,
    presets: availablePresets,
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const episodeId = parseInt(id);
  const body = await request.json().catch(() => ({}));
  const { sponsorAudioId } = body as { sponsorAudioId: number | null };

  const db = getDb();
  const episode = db.prepare(
    'SELECT audio_path, sponsor_original_audio_path FROM episodes WHERE id = ?'
  ).get(episodeId) as { audio_path: string; sponsor_original_audio_path: string | null } | undefined;

  if (!episode) {
    return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
  }

  // Determine the original (un-merged) audio path
  const originalAudioPath = episode.sponsor_original_audio_path || episode.audio_path;
  if (!originalAudioPath || !fs.existsSync(originalAudioPath)) {
    return NextResponse.json({ error: 'Original audio file not found' }, { status: 500 });
  }

  if (sponsorAudioId === null || sponsorAudioId === undefined) {
    // Remove sponsor — restore original audio
    db.prepare(`
      UPDATE episodes SET
        sponsor_audio_id = NULL,
        audio_path = ?
      WHERE id = ?
    `).run(originalAudioPath, episodeId);

    return NextResponse.json({ audioPath: originalAudioPath, sponsorAudioId: null });
  }

  // Merge with selected sponsor
  const sponsor = db.prepare(
    'SELECT audio_path FROM sponsor_audio_presets WHERE id = ? AND (expires_at IS NULL OR expires_at > datetime(\'now\'))'
  ).get(sponsorAudioId) as { audio_path: string } | undefined;

  if (!sponsor?.audio_path || !fs.existsSync(sponsor.audio_path)) {
    return NextResponse.json({ error: 'Sponsor audio not found or expired' }, { status: 400 });
  }

  const mergedPath = originalAudioPath.replace(/\.mp3$/, '_sponsor.mp3');
  const silencePath = originalAudioPath.replace(/\.mp3$/, '_silence.mp3');

  await generateSilence(silencePath, 0.3);
  await concatMp3s([sponsor.audio_path, silencePath, originalAudioPath], mergedPath);

  // Clean up silence file
  try { fs.unlinkSync(silencePath); } catch { /* ignore */ }

  const durationSec = await probeDuration(mergedPath).catch(() => null);

  db.prepare(`
    UPDATE episodes SET
      sponsor_audio_id = ?,
      sponsor_original_audio_path = ?,
      audio_path = ?,
      audio_duration_sec = ?
    WHERE id = ?
  `).run(sponsorAudioId, originalAudioPath, mergedPath, durationSec, episodeId);

  return NextResponse.json({ audioPath: mergedPath, sponsorAudioId, durationSec });
}
