/**
 * Pipeline Node: Generate Subtitles
 *
 * Transcribes TTS audio via OpenAI Whisper to get timestamps,
 * aligns original script to timestamps, generates SRT content.
 * Runs after TTS synthesis, before asset upload.
 */

import fs from 'fs-extra';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import type { PipelineState } from '../state';

const log = createChildLogger('pipeline:subtitles');

export async function generateSubtitlesNode(
  state: PipelineState
): Promise<Partial<PipelineState>> {
  log.info({ episodeId: state.episodeId }, 'Starting subtitle generation');

  if (!state.audioPath) throw new Error('No audio for subtitle generation');
  if (!state.scriptZh) throw new Error('No script_zh for subtitle generation');

  const { generateSubtitles } = await import('@/services/subtitleGenerator');

  // Build full script: sponsor text (if merged) + main script
  let fullScript = '';
  const db = getDb();
  const ep = db.prepare(
    'SELECT sponsor_audio_id FROM episodes WHERE id = ?'
  ).get(state.episodeId) as { sponsor_audio_id: number | null } | undefined;

  if (ep?.sponsor_audio_id) {
    const sponsor = db.prepare(
      'SELECT script_text FROM sponsor_audio_presets WHERE id = ?'
    ).get(ep.sponsor_audio_id) as { script_text: string } | undefined;
    if (sponsor?.script_text) {
      fullScript += sponsor.script_text + '\n';
      log.info({ sponsorId: ep.sponsor_audio_id, sponsorChars: sponsor.script_text.length }, 'Prepending sponsor script');
    }
  }
  fullScript += state.scriptZh;

  // Generate subtitles
  const result = await generateSubtitles(state.audioPath, fullScript);

  // Write SRT file alongside the audio
  const srtPath = state.audioPath.replace(/\.mp3$/, '.srt');
  await fs.writeFile(srtPath, result.srtContent, 'utf-8');

  // Store in DB
  db.prepare('UPDATE episodes SET srt_path = ?, srt_content = ? WHERE id = ?')
    .run(srtPath, result.srtContent, state.episodeId);

  // Log Whisper cost
  const durationMin = result.transcription.duration / 60;
  const costUsd = durationMin * 0.006;
  try {
    db.prepare(
      'INSERT INTO service_costs (episode_id, episode_number, service, model, units, cost_usd, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(state.episodeId, state.episodeNumber ?? null, 'openai_whisper', 'whisper-1', Math.ceil(durationMin), costUsd, 0);
  } catch (err) {
    log.warn({ error: (err as Error).message }, 'Failed to log Whisper cost');
  }

  log.info(
    { cues: result.cues.length, avgScore: (result.aligned.reduce((s, a) => s + a.matchScore, 0) / result.aligned.length * 100).toFixed(1) + '%', costUsd: costUsd.toFixed(4) },
    'Subtitle generation complete'
  );

  return {
    srtPath,
    srtContent: result.srtContent,
  };
}
