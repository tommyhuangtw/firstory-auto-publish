/**
 * hedra.js — Hedra Character-3 API client.
 *
 * Real flow (matches hedra-labs/hedra-api-starter main.py):
 *   1. POST /assets  JSON {name, type:"image"}          → { id }
 *   2. POST /assets/{id}/upload  multipart file field   → uploads binary
 *   3. Repeat 1–2 for audio (type:"audio")
 *   4. POST /generations JSON {
 *        type: "video",
 *        ai_model_id: "<Character-3 UUID>",
 *        start_keyframe_id: <imageAssetId>,
 *        audio_id: <audioAssetId>,
 *        generated_video_inputs: { text_prompt, resolution, aspect_ratio }
 *      } → { id }
 *   5. Poll /generations/{id}/status until status == "complete"
 *      → { download_url }
 *   6. GET download_url → mp4 bytes
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
// Character-3 model UUID (hardcoded in hedra-labs/hedra-api-starter).
// Can be overridden via HEDRA_MODEL_ID env var if Hedra ever rotates the id.
const HEDRA_MODEL_ID = process.env.HEDRA_MODEL_ID || 'd1dd37a3-e39a-4854-a298-6510289f9cf2';

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

  // Step 1+2: create asset record + upload binary for image and audio
  const characterAssetId = await createAndUploadAsset(apiKey, imagePath, 'image');
  const audioAssetId = await createAndUploadAsset(apiKey, audioPath, 'audio');

  // Step 3: kick off generation
  const startResp = await fetch(`${HEDRA_API_BASE}/generations`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'video',
      ai_model_id: HEDRA_MODEL_ID,
      start_keyframe_id: characterAssetId,
      audio_id: audioAssetId,
      generated_video_inputs: {
        text_prompt: 'Animated cartoon sloth walking and talking energetically, body bouncing with each step, head nodding, expressive hand gestures while speaking, walk-and-talk vlog style, lively movement, vertical mobile video',
        resolution: '720p',
        aspect_ratio: '9:16',
      },
    }),
  });

  if (!startResp.ok) {
    throw new Error(`Hedra start generation ${startResp.status}: ${await startResp.text()}`);
  }
  const { id: jobId } = await startResp.json();
  console.log(`   ⏳ job ${jobId} submitted, polling...`);

  // Step 4: poll
  const downloadUrl = await pollUntilComplete(apiKey, jobId);

  // Step 5: download (presigned URL, no auth header)
  const dlResp = await fetch(downloadUrl);
  if (!dlResp.ok) {
    throw new Error(`Hedra download ${dlResp.status} from ${downloadUrl}`);
  }
  const buf = Buffer.from(await dlResp.arrayBuffer());
  await fs.writeFile(outPath, buf);
  console.log(`   ✅ ${outPath} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
  return { path: outPath };
}

/**
 * Hedra asset upload is a 2-step flow:
 *   1) POST /assets          JSON {name, type}         → {id}
 *   2) POST /assets/{id}/upload  multipart file field  → binary upload
 */
async function createAndUploadAsset(apiKey, filePath, kind) {
  const name = path.basename(filePath);

  // Step 1: create asset record
  const createResp = await fetch(`${HEDRA_API_BASE}/assets`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, type: kind }),
  });
  if (!createResp.ok) {
    throw new Error(`Hedra create ${kind} asset failed: ${await createResp.text()}`);
  }
  const created = await createResp.json();
  const assetId = created.id;
  if (!assetId) {
    throw new Error(`Hedra create ${kind} asset: missing id in response: ${JSON.stringify(created).slice(0, 300)}`);
  }

  // Step 2: upload binary
  const buf = fs.readFileSync(filePath);
  const blob = new Blob([buf]);
  const form = new FormData();
  form.append('file', blob, name);

  const uploadResp = await fetch(`${HEDRA_API_BASE}/assets/${assetId}/upload`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey },
    body: form,
  });
  if (!uploadResp.ok) {
    throw new Error(`Hedra upload ${kind} binary failed: ${await uploadResp.text()}`);
  }

  console.log(`   📎 uploaded ${kind}: ${assetId}`);
  return assetId;
}

async function pollUntilComplete(apiKey, jobId, timeoutMs = 10 * 60 * 1000) {
  const start = Date.now();
  let lastStatus = '';
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5000));
    const resp = await fetch(`${HEDRA_API_BASE}/generations/${jobId}/status`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!resp.ok) continue;
    const body = await resp.json();
    const status = body.status;
    if (status === 'complete') {
      const url = body.download_url || body.url;
      if (!url) {
        throw new Error(`Hedra job ${jobId} complete but no download_url: ${JSON.stringify(body).slice(0, 300)}`);
      }
      return url;
    }
    if (status === 'error' || status === 'failed') {
      throw new Error(`Hedra job ${jobId} failed: ${JSON.stringify(body)}`);
    }
    if (status !== lastStatus) {
      console.log(`   [hedra] status: ${status}`);
      lastStatus = status;
    } else {
      process.stdout.write('.');
    }
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
