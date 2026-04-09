/**
 * hedra.js — Hedra Character-3 API client.
 *
 * Workflow (Hedra "characters" / "audio-driven video" endpoints):
 *   1. Upload character image → returns character_id (or pass image URL)
 *   2. Upload audio → returns audio_id
 *   3. POST /v1/characters/generate { character_id, audio_id } → returns job_id
 *   4. Poll /v1/projects/{job_id} until status == "complete", then download .mp4
 *
 * Hedra's API surface evolves quickly — verify exact paths against
 * https://docs.hedra.com/ when you provision HEDRA_API_KEY.
 *
 * Until HEDRA_API_KEY is set, returns a STUB MP4 (the static avatar image
 * looped) so the Remotion composition has something to overlay.
 */

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const HEDRA_API_BASE = process.env.HEDRA_API_BASE || 'https://api.hedra.com/web-app/public';

/**
 * Animate a still character image to lip-sync a piece of audio.
 *
 * @param {object} args
 * @param {string} args.imagePath - PNG/JPG of the character (e.g. sloth)
 * @param {string} args.audioPath - mono audio (mp3/wav/m4a)
 * @param {string} args.outPath   - destination .mp4
 * @returns {Promise<{ path: string }>}
 */
async function animate({ imagePath, audioPath, outPath }) {
  const apiKey = process.env.HEDRA_API_KEY;
  await fs.ensureDir(path.dirname(outPath));

  if (!apiKey) {
    console.warn(`⚠️  [hedra] HEDRA_API_KEY not set — generating STUB looped-image video`);
    return makeStubVideo({ imagePath, audioPath, outPath });
  }

  console.log(`🦥 [hedra] Submitting ${path.basename(imagePath)} + ${path.basename(audioPath)} ...`);

  // Step 1: upload assets (Hedra uses multipart upload to /assets endpoints)
  const characterAssetId = await uploadAsset(apiKey, imagePath, 'image');
  const audioAssetId = await uploadAsset(apiKey, audioPath, 'audio');

  // Step 2: kick off generation
  const startResp = await fetch(`${HEDRA_API_BASE}/generations`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ai_model_id: 'character-3', // Hedra Character-3
      start_keyframe_id: characterAssetId,
      audio_id: audioAssetId,
      generated_video_inputs: { aspect_ratio: '9:16', duration_ms: undefined },
    }),
  });

  if (!startResp.ok) {
    throw new Error(`Hedra start generation ${startResp.status}: ${await startResp.text()}`);
  }
  const { id: jobId } = await startResp.json();
  console.log(`   ⏳ job ${jobId} submitted, polling...`);

  // Step 3: poll
  const downloadUrl = await pollUntilComplete(apiKey, jobId);

  // Step 4: download
  const dlResp = await fetch(downloadUrl);
  const buf = Buffer.from(await dlResp.arrayBuffer());
  await fs.writeFile(outPath, buf);
  console.log(`   ✅ ${outPath}`);
  return { path: outPath };
}

async function uploadAsset(apiKey, filePath, kind) {
  const buf = fs.readFileSync(filePath);
  const blob = new Blob([buf]);
  const form = new FormData();
  form.append('file', blob, path.basename(filePath));
  form.append('type', kind);

  const resp = await fetch(`${HEDRA_API_BASE}/assets`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey },
    body: form,
  });
  if (!resp.ok) throw new Error(`Hedra upload ${kind} failed: ${await resp.text()}`);
  const data = await resp.json();
  return data.id;
}

async function pollUntilComplete(apiKey, jobId, timeoutMs = 5 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 4000));
    const resp = await fetch(`${HEDRA_API_BASE}/generations/${jobId}/status`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!resp.ok) continue;
    const body = await resp.json();
    if (body.status === 'complete' && body.url) return body.url;
    if (body.status === 'error' || body.status === 'failed') {
      throw new Error(`Hedra job ${jobId} failed: ${JSON.stringify(body)}`);
    }
    process.stdout.write('.');
  }
  throw new Error(`Hedra job ${jobId} timed out after ${timeoutMs}ms`);
}

/**
 * Stub: render the avatar image as a static video matching the audio length.
 * Good enough to slot into the Remotion composition during dev.
 */
async function makeStubVideo({ imagePath, audioPath, outPath }) {
  const cmd =
    `ffmpeg -y -nostdin -loop 1 -i "${imagePath}" -i "${audioPath}" ` +
    `-c:v libx264 -tune stillimage -pix_fmt yuv420p -r 30 ` +
    `-c:a aac -b:a 192k -shortest "${outPath}"`;
  await execAsync(cmd);
  return { path: outPath, _stub: true };
}

module.exports = { animate };
