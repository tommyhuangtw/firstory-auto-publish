import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { getDb } from '@/db';
import { concatMp3s, generateSilence, probeDuration } from '@/services/pipeline/nodes/tts';
import { shiftSRTContent, mergeSRTSegments } from '@/services/subtitleGenerator';

interface SponsorPreset {
  id: number;
  name: string;
  script_text: string;
  audio_path: string;
  audio_duration_sec: number | null;
  is_active: number;
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

  const presets = db.prepare(`
    SELECT s.*, a.content AS ad_content
    FROM sponsor_audio_presets s
    LEFT JOIN ad_presets a ON s.ad_preset_id = a.id
    ORDER BY s.is_active DESC, s.id DESC
  `).all() as (SponsorPreset & { ad_content: string | null })[];

  const availablePresets = presets.map(p => ({
    id: p.id,
    name: p.name,
    audio_duration_sec: p.audio_duration_sec,
    is_active: p.is_active,
    ad_content: p.ad_content || '',
  }));

  // Ad text used in the description when no sponsor is selected for this episode
  // (the globally active ad_preset — covers description-only ads).
  const globalAd = db.prepare(
    'SELECT content FROM ad_presets WHERE is_active = 1 LIMIT 1'
  ).get() as { content: string } | undefined;

  return NextResponse.json({
    sponsorAudioId: episode.sponsor_audio_id,
    hasOriginalAudio: !!episode.sponsor_original_audio_path,
    presets: availablePresets,
    globalAdContent: globalAd?.content || '',
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
    'SELECT audio_path, sponsor_original_audio_path, srt_content, sponsor_original_srt_content FROM episodes WHERE id = ?'
  ).get(episodeId) as {
    audio_path: string;
    sponsor_original_audio_path: string | null;
    srt_content: string | null;
    sponsor_original_srt_content: string | null;
  } | undefined;

  if (!episode) {
    return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
  }

  // Determine the original (un-merged) audio path
  const originalAudioPath = episode.sponsor_original_audio_path || episode.audio_path;
  if (!originalAudioPath || !fs.existsSync(originalAudioPath)) {
    return NextResponse.json({ error: 'Original audio file not found' }, { status: 500 });
  }
  // The clean SRT baseline (set the first time a sponsor is merged)
  const cleanSrt = episode.sponsor_original_srt_content ?? episode.srt_content;

  if (sponsorAudioId === null || sponsorAudioId === undefined) {
    // Remove sponsor — restore original audio + clean (un-shifted) subtitles
    const restoredSrt = episode.sponsor_original_srt_content ?? episode.srt_content;
    const restoredSrtPath = originalAudioPath.replace(/\.mp3$/, '.srt');
    if (restoredSrt) {
      try { fs.writeFileSync(restoredSrtPath, restoredSrt, 'utf-8'); } catch { /* ignore */ }
    }
    db.prepare(`
      UPDATE episodes SET
        sponsor_audio_id = NULL,
        audio_path = ?,
        srt_content = ?,
        srt_path = ?
      WHERE id = ?
    `).run(originalAudioPath, restoredSrt, restoredSrt ? restoredSrtPath : null, episodeId);

    // Clean up the merged file we're discarding (never the clean original)
    const prevMerged = episode.audio_path;
    if (prevMerged && prevMerged !== originalAudioPath) {
      try { fs.unlinkSync(prevMerged); } catch { /* ignore */ }
      try { fs.unlinkSync(prevMerged.replace(/\.mp3$/, '.srt')); } catch { /* ignore */ }
    }

    return NextResponse.json({ audioPath: originalAudioPath, sponsorAudioId: null });
  }

  // Merge with selected sponsor
  const sponsor = db.prepare(
    'SELECT audio_path, script_text, srt_content FROM sponsor_audio_presets WHERE id = ?'
  ).get(sponsorAudioId) as { audio_path: string; script_text: string; srt_content: string | null } | undefined;

  if (!sponsor?.audio_path || !fs.existsSync(sponsor.audio_path)) {
    return NextResponse.json({ error: 'Sponsor audio not found' }, { status: 400 });
  }

  // Include the sponsor id in the filename so switching sponsors changes the URL —
  // otherwise the browser serves the previously-merged audio from cache.
  const mergedPath = originalAudioPath.replace(/\.mp3$/, `_sponsor${sponsorAudioId}.mp3`);
  const silencePath = originalAudioPath.replace(/\.mp3$/, '_silence.mp3');

  await generateSilence(silencePath, 0.3);
  await concatMp3s([sponsor.audio_path, silencePath, originalAudioPath], mergedPath);

  // Clean up silence file
  try { fs.unlinkSync(silencePath); } catch { /* ignore */ }

  const durationSec = await probeDuration(mergedPath).catch(() => null);

  // Rebuild subtitles for the merged audio:
  //   [sponsor口播 subtitles 0..sponsorDur] + [episode subtitles shifted by sponsorDur+0.3]
  // The episode part is just shifted (free, exact). The sponsor part is transcribed
  // once per preset (it's identical across episodes) and cached on the preset, so we
  // never re-transcribe the full episode.
  let combinedSrt: string | null = null;
  let mergedSrtPath: string | null = null;
  if (cleanSrt) {
    const sponsorDur = await probeDuration(sponsor.audio_path).catch(() => null);
    if (sponsorDur != null) {
      const shiftedEpisodeSrt = shiftSRTContent(cleanSrt, sponsorDur + 0.3);

      // Ensure the sponsor口播 has cached subtitles (transcribe once, reuse forever)
      let sponsorSrt = sponsor.srt_content;
      if (!sponsorSrt && sponsor.script_text?.trim()) {
        try {
          const { generateSubtitles } = await import('@/services/subtitleGenerator');
          const r = await generateSubtitles(sponsor.audio_path, sponsor.script_text);
          sponsorSrt = r.srtContent;
          db.prepare('UPDATE sponsor_audio_presets SET srt_content = ? WHERE id = ?')
            .run(sponsorSrt, sponsorAudioId);
        } catch {
          sponsorSrt = null; // fall back to episode-only subtitles if transcription fails
        }
      }

      combinedSrt = mergeSRTSegments(sponsorSrt, shiftedEpisodeSrt);
      mergedSrtPath = mergedPath.replace(/\.mp3$/, '.srt');
      try { fs.writeFileSync(mergedSrtPath, combinedSrt, 'utf-8'); } catch { /* ignore */ }
    }
  }

  db.prepare(`
    UPDATE episodes SET
      sponsor_audio_id = ?,
      sponsor_original_audio_path = ?,
      sponsor_original_srt_content = COALESCE(sponsor_original_srt_content, ?),
      audio_path = ?,
      audio_duration_sec = ?,
      srt_content = COALESCE(?, srt_content),
      srt_path = COALESCE(?, srt_path)
    WHERE id = ?
  `).run(
    sponsorAudioId,
    originalAudioPath,
    cleanSrt,
    mergedPath,
    durationSec,
    combinedSrt,
    mergedSrtPath,
    episodeId,
  );

  // Clean up the previously-merged file (a different sponsor's merge), but never
  // the clean original.
  const prevMerged = episode.audio_path;
  if (prevMerged && prevMerged !== originalAudioPath && prevMerged !== mergedPath) {
    try { fs.unlinkSync(prevMerged); } catch { /* ignore */ }
    try { fs.unlinkSync(prevMerged.replace(/\.mp3$/, '.srt')); } catch { /* ignore */ }
  }

  return NextResponse.json({ audioPath: mergedPath, sponsorAudioId, durationSec });
}
