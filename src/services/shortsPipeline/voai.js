/**
 * voai.js — VoAI 絕好聲創 TTS API client (Taiwan-accent Chinese voices).
 *
 * VoAI provides REST endpoints under https://api.voai.ai/  (verify exact paths
 * with their dashboard once VOAI_API_KEY is provisioned). The shape used here
 * is the common pattern: POST text+voice_id → returns audio bytes (or a job id
 * to poll for async generation).
 *
 * Until VOAI_API_KEY is set this module returns a STUB silent-audio file so
 * the rest of the pipeline can run.
 *
 * NOTE: When real VoAI key arrives, just verify the endpoint path & response
 * field names against their docs and flip `STUB` to `REAL`.
 */

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const VOAI_API_BASE = process.env.VOAI_API_BASE || 'https://api.voai.ai/v1';

/**
 * @param {object} args
 * @param {string} args.text - Chinese text to synthesise
 * @param {string} args.outPath - destination .mp3 / .wav path
 * @param {string} [args.voiceId] - VoAI voice ID; falls back to env
 * @returns {Promise<{ path: string, durationSec: number }>}
 */
async function synthesize({ text, outPath, voiceId }) {
  const apiKey = process.env.VOAI_API_KEY;
  const voice = voiceId || process.env.VOAI_VOICE_ID || 'default-tw-female';
  await fs.ensureDir(path.dirname(outPath));

  if (!apiKey) {
    console.warn(`⚠️  [voai] VOAI_API_KEY not set — generating SILENT stub for "${text.slice(0, 20)}..."`);
    return makeSilentStub(text, outPath);
  }

  console.log(`🔊 [voai] Synthesising ${text.length} chars with voice "${voice}"...`);
  const resp = await fetch(`${VOAI_API_BASE}/tts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      voice_id: voice,
      // Common knobs — adjust to VoAI's actual schema once docs are confirmed
      format: 'mp3',
      speed: 1.0,
      pitch: 0,
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`VoAI API ${resp.status}: ${errBody}`);
  }

  // VoAI may return raw audio bytes OR a JSON envelope { audio_url } / { audio_base64 }.
  // Handle both.
  const ctype = resp.headers.get('content-type') || '';
  if (ctype.includes('application/json')) {
    const body = await resp.json();
    if (body.audio_url) {
      const audioResp = await fetch(body.audio_url);
      const buf = Buffer.from(await audioResp.arrayBuffer());
      await fs.writeFile(outPath, buf);
    } else if (body.audio_base64) {
      await fs.writeFile(outPath, Buffer.from(body.audio_base64, 'base64'));
    } else {
      throw new Error('VoAI JSON response had no audio_url or audio_base64');
    }
  } else {
    const buf = Buffer.from(await resp.arrayBuffer());
    await fs.writeFile(outPath, buf);
  }

  const dur = await probeDuration(outPath);
  console.log(`   ✅ ${path.basename(outPath)} (${dur.toFixed(1)}s)`);
  return { path: outPath, durationSec: dur };
}

/**
 * Stub: render N seconds of silence so downstream FFmpeg/Remotion still has a
 * real audio file to mix. Length is estimated from the text length.
 */
async function makeSilentStub(text, outPath) {
  // Roughly 3.5 chars/second for Mandarin spoken at conversational speed
  const estDur = Math.max(2, Math.min(15, text.length / 3.5));
  const cmd =
    `ffmpeg -y -nostdin -f lavfi -i anullsrc=channel_layout=mono:sample_rate=44100 ` +
    `-t ${estDur.toFixed(2)} -c:a aac -b:a 128k "${outPath}"`;
  await execAsync(cmd);
  return { path: outPath, durationSec: estDur, _stub: true };
}

async function probeDuration(audioPath) {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
  );
  return parseFloat(stdout.trim());
}

module.exports = { synthesize };
