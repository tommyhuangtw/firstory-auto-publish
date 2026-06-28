/**
 * Verify Approach A on the episodes that were broken with Whisper.
 *
 * For each episode id: re-synthesize its real script through the SAME TTS chunk
 * path the pipeline uses, derive subtitles from the chunk timings (no Whisper),
 * and report coverage = last-cue-end / audio-duration. The Whisper bug produced
 * ~68-70% coverage; chunk timing should produce ~99%. Optionally burns a video
 * with hardcoded subtitles so you can watch the back half stay in sync.
 *
 * Usage:
 *   npx tsx scripts/verify-chunk-subtitles.ts 115 106          # audio + srt + coverage
 *   npx tsx scripts/verify-chunk-subtitles.ts 115 --video      # also burn an MP4
 */

import dotenv from 'dotenv';
import fs from 'fs-extra';
import path from 'path';
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
import { getDb } from '../src/db';
import {
  buildChunks,
  cleanTextForTts,
  synthesizeChunk,
  concatMp3s,
  probeDuration,
  getSponsorAudioConfig, // not used; ensures module side-effects load cleanly
} from '../src/services/pipeline/nodes/tts';
import {
  buildSubtitlesFromChunks,
  srtCoverage,
  parseSRT,
  type ChunkTiming,
} from '../src/services/subtitleGenerator';
import { createVideoFromAudio } from '../src/services/videoCreator';

void getSponsorAudioConfig;

const DAILY_AUDIO_CONFIG = { speed: 1.1, pitch_shift: 1.5, style_weight: 0.8, breath_pause: 0.15 };
const WEEKLY_AUDIO_CONFIG = { speed: 1.1, pitch_shift: 1.5, style_weight: 0.8, breath_pause: 0.15 };

async function verifyEpisode(id: number, makeVideo: boolean) {
  const db = getDb();
  const ep = db.prepare(
    'SELECT id, episode_number, segment_type, script_zh, cover_path FROM episodes WHERE id = ?'
  ).get(id) as { id: number; episode_number: number | null; segment_type: string; script_zh: string; cover_path: string } | undefined;
  if (!ep?.script_zh) { console.error(`✗ ep id=${id}: no script_zh`); return; }

  const apiKey = process.env.VOAI_API_KEY;
  if (!apiKey) { console.error('VOAI_API_KEY not set'); process.exit(1); }

  const config = ep.segment_type === 'weekly' ? WEEKLY_AUDIO_CONFIG : DAILY_AUDIO_CONFIG;

  console.log(`\n=== EP${ep.episode_number} (id=${id}, ${ep.segment_type}) ===`);
  const text = cleanTextForTts(ep.script_zh);
  const chunks = buildChunks(text);
  console.log(`  chars=${text.length}  chunks=${chunks.length}  — synthesizing...`);

  const outDir = path.join(process.cwd(), '..', 'temp', 'verify');
  await fs.ensureDir(outDir);
  const chunkDir = path.join(outDir, `.chunks_ep${id}`);
  await fs.ensureDir(chunkDir);

  // Synthesize chunks sequentially (simple & rate-friendly for a one-off verify)
  const chunkPaths: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const p = path.join(chunkDir, `chunk_${String(i).padStart(3, '0')}.mp3`);
    await synthesizeChunk(chunks[i], p, apiKey, config);
    chunkPaths.push(p);
    if ((i + 1) % 10 === 0) console.log(`    ...${i + 1}/${chunks.length}`);
  }

  const audioPath = path.join(outDir, `ep${id}_verify_audio.mp3`);
  await concatMp3s(chunkPaths, audioPath);
  const audioDur = await probeDuration(audioPath);

  // Build chunk-timing manifest from each chunk's measured duration
  const timings: ChunkTiming[] = [];
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    const d = await probeDuration(chunkPaths[i]).catch(() => 0);
    timings.push({ text: chunks[i], startSec: offset, endSec: offset + d });
    offset += d;
  }

  const { srtContent, cues } = buildSubtitlesFromChunks(timings);
  const srtPath = path.join(outDir, `ep${id}_verify.srt`);
  await fs.writeFile(srtPath, srtContent, 'utf-8');

  const coverage = srtCoverage(srtContent, audioDur);
  const parsed = parseSRT(srtContent);
  const lastEnd = parsed.length ? parsed[parsed.length - 1].endTime : 0;
  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  console.log(`  audio=${fmt(audioDur)} (${audioDur.toFixed(1)}s)  srt_end=${fmt(lastEnd)}  cues=${cues.length}`);
  console.log(`  COVERAGE = ${(coverage * 100).toFixed(1)}%  ${coverage >= 0.97 ? '✅ FIXED' : '❌ STILL BAD'}`);
  console.log(`  audio: ${audioPath}`);
  console.log(`  srt:   ${srtPath}`);

  if (makeVideo) {
    console.log('  burning video with subtitles (this takes a couple minutes)...');
    const videoPath = await createVideoFromAudio({
      audioPath,
      coverPath: ep.cover_path && fs.existsSync(ep.cover_path) ? ep.cover_path : undefined,
      srtPath,
      outputDir: outDir,
    });
    console.log(`  🎬 video: ${videoPath}`);
  }

  await fs.remove(chunkDir).catch(() => {});
}

async function main() {
  const args = process.argv.slice(2);
  const makeVideo = args.includes('--video');
  const ids = args.filter(a => /^\d+$/.test(a)).map(Number);
  if (ids.length === 0) { console.error('Usage: npx tsx scripts/verify-chunk-subtitles.ts <episodeId...> [--video]'); process.exit(1); }
  for (const id of ids) await verifyEpisode(id, makeVideo);
  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
