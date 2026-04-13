/**
 * voai.js — VoAI 絕好聲創 TTS client (Taiwan-accent Chinese).
 *
 * This mirrors the user's production n8n flow exactly:
 *   1. Split text into sentences with regex /[^。？！]+[。？！]|[^。？！]+$/g
 *   2. Pack sentences into chunks ≤ 300 chars, with the "first sentence < 5
 *      visible chars" edge case folded into the next chunk (prevents orphan
 *      "嗯。" / "對。" one-line chunks from becoming their own API call)
 *   3. Process chunks in batches of 5 (concurrent within batch, ~1.5s wait
 *      between batches — matches the n8n splitInBatches + Wait node rate limit)
 *   4. Per-chunk POST https://connect.voai.ai/TTS/generate-dialogue with
 *      x-api-key + x-output-format: mp3 headers, response is raw mp3 bytes
 *   5. FFmpeg-concat all per-chunk mp3s into the final outPath
 *
 * Voice: 昱翔 / 預設 / Neo, speed 1.08, pitch_shift 1.5,
 * style_weight 0.8, breath_pause 0.15 (matches n8n defaults).
 *
 * If VOAI_API_KEY is missing, falls back to a silent stub so the rest of the
 * pipeline can still run (defensive — should never trigger in prod).
 */

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// ── Constants (lifted verbatim from the user's n8n flow) ────────────────────
const VOAI_URL = 'https://connect.voai.ai/TTS/generate-dialogue';
const DEFAULT_VOICE = { name: '昱翔', style: '預設', version: 'Neo' };
const DEFAULT_AUDIO_CONFIG = {
  speed: 1.35,
  pitch_shift: 1.5,
  style_weight: 0.8,
  breath_pause: 0.15,
};
const CHUNK_MAX_LEN = 300;
const BATCH_SIZE = 5;
const BATCH_WAIT_MS = 1500; // matches n8n Wait node between batches

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} args
 * @param {string} args.text        - Chinese text to synthesise
 * @param {string} args.outPath     - destination audio path (.mp3 / .m4a)
 * @param {object} [args.voice]     - { name, style, version } override
 * @param {object} [args.audioConfig] - { speed, pitch_shift, style_weight, breath_pause } override
 * @returns {Promise<{ path: string, durationSec: number }>}
 */
async function synthesize({ text, outPath, voice, audioConfig }) {
  const apiKey = process.env.VOAI_API_KEY;
  const voiceCfg = { ...DEFAULT_VOICE, ...(voice || {}) };
  const audioCfg = { ...DEFAULT_AUDIO_CONFIG, ...(audioConfig || {}) };
  await fs.ensureDir(path.dirname(outPath));

  if (!apiKey) {
    console.warn(`⚠️  [voai] VOAI_API_KEY not set — generating SILENT stub for "${text.slice(0, 20)}..."`);
    return makeSilentStub(text, outPath);
  }

  const cleanText = (text || '').trim();
  if (!cleanText) throw new Error('voai.synthesize: empty text');

  const chunks = buildChunks(cleanText, CHUNK_MAX_LEN);
  console.log(`🔊 [voai] ${cleanText.length} chars → ${chunks.length} chunk(s), voice="${voiceCfg.name}"`);

  // Fast path: single chunk → synthesise straight to outPath
  if (chunks.length === 1) {
    await synthesizeChunk({
      chunk: chunks[0],
      outPath,
      apiKey,
      voice: voiceCfg,
      audioConfig: audioCfg,
    });
    const dur = await probeDuration(outPath);
    console.log(`   ✅ ${path.basename(outPath)} (${dur.toFixed(1)}s)`);
    return { path: outPath, durationSec: dur };
  }

  // Multi-chunk path: batch-5 → ffmpeg concat
  const chunkDir = path.join(path.dirname(outPath), `.voai_chunks_${Date.now()}`);
  await fs.ensureDir(chunkDir);
  try {
    const chunkPaths = await batchSynthesize({
      chunks,
      outDir: chunkDir,
      apiKey,
      voice: voiceCfg,
      audioConfig: audioCfg,
    });
    await concatMp3s(chunkPaths, outPath);
    const dur = await probeDuration(outPath);
    console.log(`   ✅ ${path.basename(outPath)} (${dur.toFixed(1)}s, ${chunks.length} chunks concatenated)`);
    return { path: outPath, durationSec: dur };
  } finally {
    await fs.remove(chunkDir).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chunking (ported from n8n Code node, with the firstLen<5 fix)
// ─────────────────────────────────────────────────────────────────────────────

function splitSentences(text) {
  const re = /[^。？！]+[。？！]|[^。？！]+$/g;
  return text.match(re) || [];
}

const visibleLen = (s) => (s || '').replace(/\s+/g, '').length;

/**
 * Pack sentences into chunks ≤ maxLen. If the *first* sentence in a new buffer
 * has fewer than 5 visible characters (things like "嗯。", "對。", "對呀。"), we
 * flush it together with the sentence that would have overflowed — i.e. we
 * don't orphan a tiny chunk.
 */
function buildChunks(text, maxLen = CHUNK_MAX_LEN) {
  const sentences = splitSentences(text);
  const result = [];
  let buf = [];
  let buflen = 0;
  let firstLen = null;

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
        // Tiny leading sentence — fold the overflow sentence in and flush
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

// ─────────────────────────────────────────────────────────────────────────────
// Per-chunk synthesis
// ─────────────────────────────────────────────────────────────────────────────

async function synthesizeChunk({ chunk, outPath, apiKey, voice, audioConfig }) {
  // n8n strips double quotes from the chunk before interpolation — same here
  const sanitized = chunk.replace(/"/g, '');

  const body = {
    input: {
      dialogue: [
        {
          voai_script_text: sanitized,
          voice,
          audio_config: audioConfig,
        },
      ],
    },
  };

  const resp = await fetch(VOAI_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'x-output-format': 'mp3',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '<no body>');
    throw new Error(`VoAI ${resp.status} on chunk "${sanitized.slice(0, 30)}...": ${errText}`);
  }

  const ctype = resp.headers.get('content-type') || '';
  // Some APIs wrap audio in JSON even when you ask for mp3 — handle both
  if (ctype.includes('application/json')) {
    const json = await resp.json();
    if (json.audio_base64) {
      await fs.writeFile(outPath, Buffer.from(json.audio_base64, 'base64'));
    } else if (json.audio_url) {
      const audioResp = await fetch(json.audio_url);
      const buf = Buffer.from(await audioResp.arrayBuffer());
      await fs.writeFile(outPath, buf);
    } else {
      throw new Error(`VoAI returned JSON without audio_base64/audio_url: ${JSON.stringify(json).slice(0, 200)}`);
    }
  } else {
    const buf = Buffer.from(await resp.arrayBuffer());
    await fs.writeFile(outPath, buf);
  }
}

async function batchSynthesize({ chunks, outDir, apiKey, voice, audioConfig }) {
  const chunkPaths = [];
  for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
    const batch = chunks.slice(batchStart, batchStart + BATCH_SIZE);
    const batchIdx = Math.floor(batchStart / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
    console.log(`   [voai] batch ${batchIdx}/${totalBatches} (${batch.length} chunk${batch.length > 1 ? 's' : ''})`);

    const results = await Promise.all(
      batch.map((chunk, i) => {
        const chunkOutPath = path.join(outDir, `chunk_${String(batchStart + i).padStart(3, '0')}.mp3`);
        return synthesizeChunk({
          chunk,
          outPath: chunkOutPath,
          apiKey,
          voice,
          audioConfig,
        }).then(() => chunkOutPath);
      })
    );
    chunkPaths.push(...results);

    // Rate-limit pause (unless this was the final batch)
    if (batchStart + BATCH_SIZE < chunks.length) {
      await sleep(BATCH_WAIT_MS);
    }
  }
  return chunkPaths;
}

// ─────────────────────────────────────────────────────────────────────────────
// FFmpeg concat (stream-copy fast path, re-encode fallback)
// ─────────────────────────────────────────────────────────────────────────────

async function concatMp3s(chunkPaths, finalPath) {
  if (chunkPaths.length === 0) throw new Error('concatMp3s: no chunks');
  if (chunkPaths.length === 1) {
    await fs.copy(chunkPaths[0], finalPath);
    return;
  }

  // FFmpeg concat demuxer resolves paths RELATIVE TO THE LIST FILE, not cwd.
  // We put the list file in the same dir as the chunks and use basenames so
  // paths resolve cleanly regardless of cwd.
  const chunkDir = path.dirname(chunkPaths[0]);
  const listFile = path.join(chunkDir, 'concat_list.txt');
  const listContent = chunkPaths
    .map((p) => `file '${path.basename(p).replace(/'/g, "'\\''")}'`)
    .join('\n');
  await fs.writeFile(listFile, listContent);

  // Try stream copy first (fast, no quality loss)
  const copyCmd = `ffmpeg -y -nostdin -f concat -safe 0 -i "${listFile}" -c copy "${finalPath}"`;
  try {
    await execAsync(copyCmd);
  } catch (err) {
    // Fallback: re-encode (handles codec/sample-rate mismatches)
    console.warn(`   [voai] stream copy failed, re-encoding: ${err.message.split('\n')[0]}`);
    const reencCmd = `ffmpeg -y -nostdin -f concat -safe 0 -i "${listFile}" -c:a aac -b:a 192k "${finalPath}"`;
    await execAsync(reencCmd);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function probeDuration(audioPath) {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
  );
  return parseFloat(stdout.trim());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Defensive silent-audio stub, used only if VOAI_API_KEY is missing at runtime.
 */
async function makeSilentStub(text, outPath) {
  const estDur = Math.max(2, Math.min(15, text.length / 3.5));
  const cmd =
    `ffmpeg -y -nostdin -f lavfi -i anullsrc=channel_layout=mono:sample_rate=44100 ` +
    `-t ${estDur.toFixed(2)} -c:a aac -b:a 128k "${outPath}"`;
  await execAsync(cmd);
  return { path: outPath, durationSec: estDur, _stub: true };
}

module.exports = {
  synthesize,
  splitSentences,
  buildChunks,
  // exported for targeted tests
  DEFAULT_VOICE,
  DEFAULT_AUDIO_CONFIG,
  CHUNK_MAX_LEN,
};
