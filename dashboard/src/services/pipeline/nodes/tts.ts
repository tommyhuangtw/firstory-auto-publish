/**
 * Stage 7: TTS — VoAI Text-to-Speech synthesis.
 *
 * Ported from src/services/shortsPipeline/voai.js.
 * Splits Chinese script → chunks ≤190 chars → batch-5 synthesis → FFmpeg concat.
 */

import fs from 'fs-extra';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createChildLogger } from '@/lib/logger';
import { withRetry } from '@/lib/retry';
import { getDb } from '@/db';
import type { PipelineState } from '../state';
import type { ChunkTiming } from '@/services/subtitleGenerator';

const log = createChildLogger('pipeline:tts');
const execAsync = promisify(exec);

// Constants (from n8n flow)
const VOAI_URL = 'https://connect.voai.ai/TTS/generate-dialogue';
const DEFAULT_VOICE = { name: '昱翔', style: '預設', version: 'Neo' };
const DAILY_AUDIO_CONFIG = {
  speed: 1.1,
  pitch_shift: 1.5,
  style_weight: 0.8,
  breath_pause: 0.15,
};
const WEEKLY_AUDIO_CONFIG = {
  speed: 1.1,
  pitch_shift: 1.5,
  style_weight: 0.8,
  breath_pause: 0.15,
};
const ROBOT_AUDIO_CONFIG = {
  speed: 1.07,
  pitch_shift: 1.5,
  style_weight: 0.8,
  breath_pause: 0.15,
};
const SYSDESIGN_AUDIO_CONFIG = {
  speed: 1.05,
  pitch_shift: 1.5,
  style_weight: 0.8,
  breath_pause: 0.15,
};
const CHUNK_MAX_LEN = 190;
const BATCH_SIZE = 2;
const BATCH_WAIT_MS = 3000;

export const SPONSOR_AUDIO_CONFIG = {
  speed: 1.18,
  pitch_shift: 1.5,
  style_weight: 0.8,
  breath_pause: 0.15,
};
const OUTPUT_DIR = path.join(process.cwd(), '..', 'temp', 'tts');

function getAudioConfig(segmentType: string) {
  const base = segmentType === 'weekly' ? WEEKLY_AUDIO_CONFIG
    : segmentType === 'robot' ? ROBOT_AUDIO_CONFIG
    : segmentType === 'sysdesign' ? SYSDESIGN_AUDIO_CONFIG
    : DAILY_AUDIO_CONFIG;

  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?')
      .get(`tts_speed_${segmentType}`) as { value: string } | undefined;
    if (row?.value) {
      const speed = parseFloat(row.value);
      if (!isNaN(speed) && speed >= 0.5 && speed <= 2.0) {
        return { ...base, speed };
      }
    }
  } catch { /* DB not available — use hardcoded default */ }
  return base;
}

export function getSponsorAudioConfig() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?')
      .get('tts_speed_sponsor') as { value: string } | undefined;
    if (row?.value) {
      const speed = parseFloat(row.value);
      if (!isNaN(speed) && speed >= 0.5 && speed <= 2.0) {
        return { ...SPONSOR_AUDIO_CONFIG, speed };
      }
    }
  } catch { /* DB not available — use hardcoded default */ }
  return SPONSOR_AUDIO_CONFIG;
}

export async function tts(state: PipelineState): Promise<Partial<PipelineState>> {
  log.info({ episodeId: state.episodeId }, 'Starting TTS synthesis');

  const audioConfig = getAudioConfig(state.segmentType);
  const rawText = state.scriptZh || '';
  if (!rawText) {
    throw new Error('No script for TTS — scriptZh is empty (possible snapshot reconstruction failure)');
  }

  // Text cleaning for TTS (matches n8n 清理文字供TTS使用)
  const text = cleanTextForTts(rawText);
  log.info({ rawLength: rawText.length, cleanLength: text.length }, 'Text cleaned for TTS');

  const apiKey = process.env.VOAI_API_KEY;
  await fs.ensureDir(OUTPUT_DIR);
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
  const outPath = path.join(OUTPUT_DIR, `${dateStr}_${timeStr}_${state.segmentType}_audio.mp3`);

  if (!apiKey) {
    log.warn('VOAI_API_KEY not set, generating silent stub');
    const result = await makeSilentStub(text, outPath);
    return { audioPath: result.path, audioDurationSec: result.durationSec, status: 'pending_review' };
  }

  const ttsStartMs = Date.now();
  const chunks = buildChunks(text, CHUNK_MAX_LEN);
  log.info({ textLength: text.length, chunks: chunks.length }, 'Text chunked');

  // Single chunk: direct synthesis
  if (chunks.length === 1) {
    await synthesizeChunk(chunks[0], outPath, apiKey, audioConfig);
    const dur = await probeDuration(outPath);
    log.info({ duration: dur.toFixed(1) }, 'TTS complete (single chunk)');
    logTtsCost(state.episodeId, state.episodeNumber, text.length, Date.now() - ttsStartMs);
    return {
      audioPath: outPath,
      audioDurationSec: dur,
      ttsChunkTimings: [{ text: chunks[0], startSec: 0, endSec: dur }],
      status: 'pending_review',
    };
  }

  // Multi chunk: batch synthesis + concat
  const chunkDir = path.join(OUTPUT_DIR, `.chunks_${Date.now()}`);
  await fs.ensureDir(chunkDir);

  try {
    const chunkPaths: string[] = [];
    let currentBatchSize = BATCH_SIZE;

    for (let batchStart = 0; batchStart < chunks.length; batchStart += currentBatchSize) {
      const batch = chunks.slice(batchStart, batchStart + currentBatchSize);
      const batchNum = Math.floor(batchStart / currentBatchSize) + 1;
      const totalBatches = Math.ceil(chunks.length / currentBatchSize);
      log.info({ batch: batchNum, total: totalBatches, size: batch.length, batchSize: currentBatchSize }, 'Processing batch');

      try {
        const paths = await Promise.all(
          batch.map(async (chunk, i) => {
            const chunkPath = path.join(chunkDir, `chunk_${String(batchStart + i).padStart(3, '0')}.mp3`);
            await synthesizeChunk(chunk, chunkPath, apiKey, audioConfig);
            return chunkPath;
          })
        );
        chunkPaths.push(...paths);
      } catch (err) {
        if (currentBatchSize > 1) {
          log.warn({ batch: batchNum, error: (err as Error).message },
            'Batch failed, downgrading to sequential (batch size 1)');
          currentBatchSize = 1;
          // Re-process this batch from the start, now one at a time
          batchStart -= currentBatchSize;
          await sleep(BATCH_WAIT_MS);
          continue;
        }
        throw err; // Sequential also failed — give up
      }

      // Rate limit between batches
      if (batchStart + currentBatchSize < chunks.length) {
        await sleep(BATCH_WAIT_MS);
      }
    }

    const uniquePaths = [...new Set(chunkPaths)];
    await concatMp3s(uniquePaths, outPath);
    const dur = await probeDuration(outPath);
    log.info({ duration: dur.toFixed(1), chunks: chunks.length }, 'TTS complete');
    logTtsCost(state.episodeId, state.episodeNumber, text.length, Date.now() - ttsStartMs);

    // Build the chunk-timing manifest while the per-chunk files still exist (the
    // finally block deletes chunkDir). Each chunk's text is ground truth; its
    // duration (ffprobe) and accumulated offset give exact subtitle timings —
    // the subtitle node uses this instead of re-transcribing with Whisper.
    const ttsChunkTimings: ChunkTiming[] = [];
    let offsetSec = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunkPath = path.join(chunkDir, `chunk_${String(i).padStart(3, '0')}.mp3`);
      const chunkDur = await probeDuration(chunkPath).catch(() => 0);
      ttsChunkTimings.push({ text: chunks[i], startSec: offsetSec, endSec: offsetSec + chunkDur });
      offsetSec += chunkDur;
    }
    const coverage = dur > 0 ? offsetSec / dur : 0;
    log.info(
      { chunks: ttsChunkTimings.length, summedSec: offsetSec.toFixed(1), audioSec: dur.toFixed(1), coverage: coverage.toFixed(3) },
      'Built TTS chunk-timing manifest for subtitles'
    );

    return { audioPath: outPath, audioDurationSec: dur, ttsChunkTimings, status: 'pending_review' };
  } finally {
    await fs.remove(chunkDir).catch(() => {});
  }
}

// ── Chunking (from voai.js) ──

function splitSentences(text: string): string[] {
  return text.match(/[^。？！]+[。？！]|[^。？！]+$/g) || [];
}

const visibleLen = (s: string) => (s || '').replace(/\s+/g, '').length;

export function buildChunks(text: string, maxLen: number = CHUNK_MAX_LEN): string[] {
  const sentences = splitSentences(text);
  const result: string[] = [];
  let buf: string[] = [];
  let buflen = 0;
  let firstLen: number | null = null;

  const flush = () => {
    if (buf.length === 0) return;
    const chunk = buf.join('').trim();
    if (chunk.length > 0) result.push(chunk);
    buf = [];
    buflen = 0;
    firstLen = null;
  };

  for (const s of sentences) {
    if (!s) continue;
    const nextLen = buflen + s.length;
    if (buf.length === 0) firstLen = visibleLen(s);

    if (nextLen <= maxLen) {
      buf.push(s);
      buflen = nextLen;
    } else {
      if (firstLen !== null && firstLen < 5) {
        buf.push(s);
        flush();
      } else {
        flush();
        buf.push(s);
        buflen = s.length;
        firstLen = visibleLen(s);
      }
    }
  }
  flush();
  return result;
}

// ── Synthesis ──

export async function synthesizeChunk(chunk: string, outPath: string, apiKey: string, audioConfig = DAILY_AUDIO_CONFIG): Promise<void> {
  const sanitized = chunk.replace(/"/g, '');

  const resp = await withRetry(
    async () => {
      const r = await fetch(VOAI_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'x-output-format': 'mp3',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          input: {
            dialogue: [{
              voai_script_text: sanitized,
              voice: DEFAULT_VOICE,
              audio_config: audioConfig,
            }],
          },
        }),
      });
      if (!r.ok) {
        const errText = await r.text().catch(() => '<no body>');
        throw new Error(`VoAI ${r.status}: ${errText}`);
      }
      return r;
    },
    { label: 'voai-tts' },
  );

  const ctype = resp.headers.get('content-type') || '';
  if (ctype.includes('application/json')) {
    const json = await resp.json();
    if (json.audio_base64) {
      await fs.writeFile(outPath, Buffer.from(json.audio_base64, 'base64'));
    } else if (json.audio_url) {
      const audioResp = await fetch(json.audio_url);
      await fs.writeFile(outPath, Buffer.from(await audioResp.arrayBuffer()));
    } else {
      throw new Error('VoAI returned JSON without audio');
    }
  } else {
    await fs.writeFile(outPath, Buffer.from(await resp.arrayBuffer()));
  }
}

// ── FFmpeg ──

export async function concatMp3s(chunkPaths: string[], finalPath: string): Promise<void> {
  if (chunkPaths.length === 0) throw new Error('No chunks to concat');
  if (chunkPaths.length === 1) {
    await fs.copy(chunkPaths[0], finalPath);
    return;
  }

  const chunkDir = path.dirname(chunkPaths[0]);
  const listFile = path.join(chunkDir, 'concat_list.txt');
  const listContent = chunkPaths
    .map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`)
    .join('\n');
  await fs.writeFile(listFile, listContent);

  try {
    await execAsync(`ffmpeg -y -nostdin -f concat -safe 0 -i "${listFile}" -c copy "${finalPath}"`);
  } catch {
    log.warn('Stream copy failed, re-encoding');
    await execAsync(`ffmpeg -y -nostdin -f concat -safe 0 -i "${listFile}" -c:a libmp3lame -b:a 192k "${finalPath}"`);
  }
}

export async function probeDuration(audioPath: string): Promise<number> {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
  );
  return parseFloat(stdout.trim());
}

export async function generateSilence(outPath: string, durationSec: number, sampleRate = 32000): Promise<void> {
  await execAsync(
    `ffmpeg -y -nostdin -f lavfi -i anullsrc=channel_layout=mono:sample_rate=${sampleRate} -t ${durationSec.toFixed(2)} -c:a libmp3lame -b:a 128k "${outPath}"`
  );
}

async function makeSilentStub(text: string, outPath: string) {
  const estDur = Math.max(2, Math.min(15, text.length / 3.5));
  await execAsync(
    `ffmpeg -y -nostdin -f lavfi -i anullsrc=channel_layout=mono:sample_rate=44100 -t ${estDur.toFixed(2)} -c:a aac -b:a 128k "${outPath}"`
  );
  return { path: outPath, durationSec: estDur };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function logTtsCost(episodeId: number, episodeNumber: number | null | undefined, charCount: number, latencyMs: number) {
  try {
    const db = getDb();
    const usdToTwd = parseFloat(
      (db.prepare("SELECT value FROM settings WHERE key = 'usd_to_twd'").get() as { value: string })?.value || '32.0'
    );
    const costPerCharTwd = parseFloat(
      (db.prepare("SELECT value FROM settings WHERE key = 'voai_cost_per_char_twd'").get() as { value: string })?.value || '0.06'
    );
    const costUsd = (charCount * costPerCharTwd) / usdToTwd;
    db.prepare(
      'INSERT INTO service_costs (episode_id, episode_number, service, model, units, cost_usd, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(episodeId, episodeNumber ?? null, 'voai_tts', 'neo', charCount, costUsd, latencyMs);
    log.info({ charCount, costUsd: costUsd.toFixed(4) }, 'TTS cost logged');
  } catch (err) {
    log.warn({ error: (err as Error).message }, 'Failed to log TTS cost');
  }
}

/**
 * Clean text for TTS — strips JSON wrappers, escaped chars, markdown artifacts.
 * Safety net: translate node should already clean, but TTS is the last gate.
 */
export function cleanTextForTts(raw: string): string {
  let text = raw.trim();

  // Strip JSON wrapper if LLM returned { "original_script": "..." }
  try {
    const jsonStr = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(jsonStr);
    const val = parsed.original_script || parsed.script || parsed.translated_script || parsed.content;
    if (val && typeof val === 'string') {
      text = val.trim();
    }
  } catch {
    // Truncated/unterminated JSON wrapper — JSON.parse fails but we must still strip the
    // `original_script` key so it never gets spoken aloud (the 2026-07-09 bug).
    const openKey = text.match(/\{\s*"(?:original_script|script|translated_script|content)"\s*:\s*"/);
    if (openKey) {
      text = text.slice((openKey.index ?? 0) + openKey[0].length).replace(/"\s*\}?\s*$/, '').replace(/\\"/g, '"');
    }
  }

  // Strip markdown fences
  text = text.replace(/^```(?:json)?\s*/g, '').replace(/\s*```$/g, '');

  // Clean whitespace and special chars
  text = text
    .replace(/`/g, '')
    .replace(/\\n/g, ' ')       // literal \n in text
    .replace(/\\t/g, ' ')       // literal \t in text
    .replace(/(\n)+/g, ' ')     // actual newlines
    .replace(/(\t)+/g, ' ')     // actual tabs
    .replace(/\s{2,}/g, ' ')    // collapse multiple spaces
    .trim();

  return text;
}
