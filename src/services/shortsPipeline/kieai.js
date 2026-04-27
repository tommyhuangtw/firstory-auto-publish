/**
 * kieai.js — kie.ai client for video/image generation.
 *
 * Two capabilities:
 *   1. Hero B-roll: Veo 3 Fast text-to-video for cinematic opening clips
 *   2. Sloth animation: Seedance 1.0 Pro Fast image-to-video (first frame = sloth image)
 *   3. Cover image editing: nano-banana-edit for text removal / outpainting
 *
 * API endpoints:
 *   - Veo 3:   POST /api/v1/veo/generate + GET /api/v1/veo/record-info
 *   - Jobs:    POST /api/v1/jobs/createTask + GET /api/v1/jobs/recordInfo
 */

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');

const KIE_BASE = 'https://api.kie.ai';
const GENERATE_URL = `${KIE_BASE}/api/v1/veo/generate`;
const RECORD_INFO_URL = `${KIE_BASE}/api/v1/veo/record-info`;

const DEFAULT_MODEL = 'veo3_fast';
const POLL_INTERVAL_MS = 30_000;
const MAX_POLL_ATTEMPTS = 20; // 20 * 30s = 10 min cap

/**
 * Wrap a raw keyword into a cinematic vertical-first prompt.
 * Veo responds well to very visual, camera-direction heavy prompts.
 */
function buildCinematicPrompt(keyword) {
  return (
    `Cinematic vertical 9:16 shot, ${keyword}, shallow depth of field, ` +
    `dynamic camera motion, vibrant volumetric lighting, high detail, ` +
    `shot on Arri Alexa, photorealistic, 8 second clip`
  );
}

/**
 * Generate one Veo 3 Fast hero B-roll clip for the given keyword and save it
 * to outPath. Returns { path, sourceUrl, _hero: true } or throws.
 *
 * @param {object} args
 * @param {string} args.keyword       - e.g. "ChatGPT writing code"
 * @param {string} args.outPath       - destination mp4 path
 * @param {string} [args.promptOverride] - use this prompt instead of the generated one
 * @param {number} [args.durationSec] - informational only (Veo is fixed 8s)
 */
async function generateHeroBroll({ keyword, outPath, promptOverride }) {
  const apiKey = process.env.KIE_AI_API_KEY;
  if (!apiKey) {
    throw new Error('kieai.generateHeroBroll: KIE_AI_API_KEY not set');
  }
  await fs.ensureDir(path.dirname(outPath));

  const prompt = promptOverride || buildCinematicPrompt(keyword);
  console.log(`🎬 [kie.ai] Submitting Veo 3 Fast job: "${keyword.slice(0, 40)}"`);
  console.log(`   prompt: ${prompt.slice(0, 100)}...`);

  // ── Submit ────────────────────────────────────────────────────────────
  const submitResp = await fetch(GENERATE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      model: DEFAULT_MODEL,
      aspectRatio: '9:16',
      enableFallback: false,
      enableTranslation: true,
    }),
  });

  if (!submitResp.ok) {
    const errText = await submitResp.text().catch(() => '<no body>');
    throw new Error(`kie.ai submit ${submitResp.status}: ${errText}`);
  }
  const submitJson = await submitResp.json();
  if (submitJson.code !== 200 || !submitJson.data?.taskId) {
    throw new Error(`kie.ai submit unexpected response: ${JSON.stringify(submitJson).slice(0, 300)}`);
  }
  const taskId = submitJson.data.taskId;
  console.log(`   taskId: ${taskId}`);

  // ── Poll ──────────────────────────────────────────────────────────────
  let resultUrl = null;
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    const pollResp = await fetch(`${RECORD_INFO_URL}?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) {
      console.warn(`   [kie.ai] poll ${attempt} → HTTP ${pollResp.status}, retrying`);
      continue;
    }
    const pollJson = await pollResp.json();
    const data = pollJson.data || {};
    const flag = data.successFlag;
    if (flag === 1) {
      resultUrl = data.response?.resultUrls?.[0];
      if (!resultUrl) {
        throw new Error(`kie.ai: successFlag=1 but no resultUrls in response: ${JSON.stringify(data).slice(0, 300)}`);
      }
      console.log(`   [kie.ai] completed after ${attempt} polls`);
      break;
    }
    if (flag !== undefined && flag !== 0 && flag !== null) {
      throw new Error(
        `kie.ai task failed: successFlag=${flag}, errorCode=${data.errorCode}, errorMessage=${data.errorMessage}`
      );
    }
    console.log(`   [kie.ai] poll ${attempt}/${MAX_POLL_ATTEMPTS} — still generating`);
  }

  if (!resultUrl) {
    throw new Error(`kie.ai: timed out after ${MAX_POLL_ATTEMPTS} polls (~${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 60000} min)`);
  }

  // ── Download ──────────────────────────────────────────────────────────
  console.log(`   [kie.ai] downloading ${resultUrl}`);
  const dlResp = await fetch(resultUrl);
  if (!dlResp.ok) {
    throw new Error(`kie.ai download ${dlResp.status} from ${resultUrl}`);
  }
  const buf = Buffer.from(await dlResp.arrayBuffer());
  await fs.writeFile(outPath, buf);
  console.log(`   ✅ ${path.basename(outPath)} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);

  return {
    path: outPath,
    sourceUrl: resultUrl,
    keyword,
    _hero: true,
  };
}

/**
 * Generate animated sloth video clips via Kling 2.6 (Image-to-Video).
 * Uses the sloth image as the first frame. Two variants:
 *   - Hook: talking/gesturing naturally (for opening + interstitials)
 *   - Outro: inviting gesture, waving, pointing down (CTA feel)
 * Cost: ~110 credits ($0.56) per short (2 x 10s clips).
 * Returns { path, sourceUrl, _slothVideo: true } or throws.
 */
const SLOTH_VIDEO_MODEL = 'kling-2.6/image-to-video';
const SLOTH_VIDEO_DURATION = '10';

const SLOTH_HOOK_PROMPT =
  'Animate this character talking and gesturing naturally in place, ' +
  'as if recording a podcast or vlog. The character looks at camera, ' +
  'smiles, nods, waves hands while explaining something excitedly. ' +
  'Keep the same background and setting. Subtle body movement, ' +
  'lively facial expressions. Vertical 9:16 framing.';

const SLOTH_OUTRO_PROMPT =
  'Animate this character doing a friendly farewell and call-to-action gesture. ' +
  'The character looks at camera, smiles warmly, waves goodbye with one hand, ' +
  'then points downward enthusiastically as if saying "click the link below". ' +
  'Keep the same background and setting. Cheerful, inviting energy. ' +
  'Vertical 9:16 framing.';

async function generateSlothVideo({ outPath, avatarImagePath, prompt }) {
  prompt = prompt || SLOTH_HOOK_PROMPT;
  const apiKey = process.env.KIE_AI_API_KEY;
  if (!apiKey) {
    throw new Error('kieai.generateSlothVideo: KIE_AI_API_KEY not set');
  }
  await fs.ensureDir(path.dirname(outPath));

  // Upload reference image as first frame
  console.log(`🦥 [kie.ai] Uploading reference image to Cloudinary...`);
  const publicUrl = await uploadToTmpHost(avatarImagePath);
  console.log(`   referenceImage: ${publicUrl}`);

  console.log(`🦥 [kie.ai] Submitting Kling 2.6 I2V job (${SLOTH_VIDEO_DURATION}s)`);
  console.log(`   prompt: ${prompt.slice(0, 100)}...`);

  // ── Submit via unified jobs API ─────────────────────────────────────
  const submitResp = await fetch(JOBS_CREATE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: SLOTH_VIDEO_MODEL,
      input: {
        prompt,
        image_urls: [publicUrl],
        duration: SLOTH_VIDEO_DURATION,
        aspect_ratio: '9:16',
        sound: false,
      },
    }),
  });

  if (!submitResp.ok) {
    const errText = await submitResp.text().catch(() => '<no body>');
    throw new Error(`kie.ai sloth video submit ${submitResp.status}: ${errText}`);
  }
  const submitJson = await submitResp.json();
  if (submitJson.code !== 200 || !submitJson.data?.taskId) {
    throw new Error(`kie.ai sloth video unexpected response: ${JSON.stringify(submitJson).slice(0, 300)}`);
  }
  const taskId = submitJson.data.taskId;
  console.log(`   taskId: ${taskId}`);

  // ── Poll via unified jobs API ───────────────────────────────────────
  let resultUrl = null;
  for (let attempt = 1; attempt <= IMG_MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(IMG_POLL_INTERVAL_MS);
    const pollResp = await fetch(`${JOBS_RECORD_URL}?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) {
      console.warn(`   [kie.ai] poll ${attempt} → HTTP ${pollResp.status}, retrying`);
      continue;
    }
    const pollJson = await pollResp.json();
    const data = pollJson.data || {};
    const state = data.state;
    if (state === 'success') {
      let parsed = {};
      try {
        parsed = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : (data.resultJson || {});
      } catch (_) { /* ignore */ }
      resultUrl =
        parsed.resultUrls?.[0] ||
        parsed.result_urls?.[0] ||
        data.response?.resultUrls?.[0] ||
        data.resultUrls?.[0];
      if (!resultUrl) {
        throw new Error(`kie.ai sloth video: state=success but no resultUrls: ${JSON.stringify(data).slice(0, 400)}`);
      }
      console.log(`   [kie.ai] sloth video completed after ${attempt} polls`);
      break;
    }
    if (state === 'fail' || state === 'failed') {
      throw new Error(
        `kie.ai sloth video failed: ${data.failMsg || data.errorMessage || JSON.stringify(data).slice(0, 200)}`
      );
    }
    if (attempt % 5 === 0) {
      console.log(`   [kie.ai] poll ${attempt}/${IMG_MAX_POLL_ATTEMPTS} — state=${state || 'unknown'}`);
    }
  }

  if (!resultUrl) {
    throw new Error(`kie.ai sloth video: timed out after ${IMG_MAX_POLL_ATTEMPTS} polls`);
  }

  // ── Download ────────────────────────────────────────────────────────
  console.log(`   [kie.ai] downloading ${resultUrl}`);
  const dlResp = await fetch(resultUrl);
  if (!dlResp.ok) {
    throw new Error(`kie.ai sloth video download ${dlResp.status} from ${resultUrl}`);
  }
  const buf = Buffer.from(await dlResp.arrayBuffer());
  await fs.writeFile(outPath, buf);
  console.log(`   ✅ ${path.basename(outPath)} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);

  return {
    path: outPath,
    sourceUrl: resultUrl,
    _slothVideo: true,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════════════════════
// Image editing via google/nano-banana-edit (pre-Hedra cover cleanup)
// ═══════════════════════════════════════════════════════════════════════════

const JOBS_CREATE_URL = `${KIE_BASE}/api/v1/jobs/createTask`;
const JOBS_RECORD_URL = `${KIE_BASE}/api/v1/jobs/recordInfo`;
const NANO_BANANA_EDIT_MODEL = 'google/nano-banana-edit';
const IMG_POLL_INTERVAL_MS = 5_000;
const IMG_MAX_POLL_ATTEMPTS = 60; // 60 * 5s = 5 min cap

const DEFAULT_EDIT_PROMPT =
  'Transform this image: ' +
  '1) Remove ALL text, speech bubbles, Chinese characters, titles, logos, and overlays completely. ' +
  '2) Redraw the sloth character in a dynamic mid-stride walking pose — one leg clearly forward, the other pushing off behind, ' +
  'arms swinging naturally, body leaning slightly forward with momentum. ' +
  'The sloth is casually strolling down a sunny city sidewalk like filming a walk-and-talk vlog. ' +
  '3) Background: bright outdoor urban street with trees, soft bokeh, warm golden-hour sunlight. ' +
  'Keep the exact same sloth character design, art style, clothing, and color palette. ' +
  'Vertical 9:16 framing, full body visible head to toe, sloth centered. No text anywhere.';

const crypto = require('crypto');

/**
 * Upload a local image to Cloudinary and return a public URL.
 * Requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in .env.
 */
async function uploadToTmpHost(imagePath) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary credentials not set (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)');
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const folder = 'shorts_tmp';
  const paramsToSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash('sha1').update(paramsToSign).digest('hex');

  const buf = await fs.readFile(imagePath);
  const form = new FormData();
  form.append('file', new Blob([buf]), path.basename(imagePath));
  form.append('api_key', apiKey);
  form.append('timestamp', timestamp);
  form.append('signature', signature);
  form.append('folder', folder);

  const resp = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: 'POST', body: form },
  );
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Cloudinary upload ${resp.status}: ${errText}`);
  }
  const json = await resp.json();
  return json.secure_url;
}

/**
 * Edit a podcast cover image via kie.ai nano-banana-edit:
 *   1) remove baked-in text/logos
 *   2) outpaint to 9:16
 * Returns { path, sourceUrl, _imageEdit: true } on success, or throws.
 */
async function editCoverImage({ inputImagePath, outPath, prompt }) {
  const apiKey = process.env.KIE_AI_API_KEY;
  if (!apiKey) {
    throw new Error('kieai.editCoverImage: KIE_AI_API_KEY not set');
  }
  await fs.ensureDir(path.dirname(outPath));

  console.log(`🖼️  [kie.ai] uploading cover to Cloudinary...`);
  const publicUrl = await uploadToTmpHost(inputImagePath);
  console.log(`   publicUrl: ${publicUrl}`);

  const editPrompt = prompt || DEFAULT_EDIT_PROMPT;
  console.log(`🖼️  [kie.ai] Submitting nano-banana-edit job`);
  console.log(`   prompt: ${editPrompt.slice(0, 100)}...`);

  // ── Submit ────────────────────────────────────────────────────────────
  const submitResp = await fetch(JOBS_CREATE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: NANO_BANANA_EDIT_MODEL,
      input: {
        prompt: editPrompt,
        image_urls: [publicUrl],
        image_size: '9:16',
        output_format: 'png',
      },
    }),
  });
  if (!submitResp.ok) {
    const errText = await submitResp.text().catch(() => '<no body>');
    throw new Error(`kie.ai image submit ${submitResp.status}: ${errText}`);
  }
  const submitJson = await submitResp.json();
  if (submitJson.code !== 200 || !submitJson.data?.taskId) {
    throw new Error(`kie.ai image submit unexpected response: ${JSON.stringify(submitJson).slice(0, 300)}`);
  }
  const taskId = submitJson.data.taskId;
  console.log(`   taskId: ${taskId}`);

  // ── Poll ──────────────────────────────────────────────────────────────
  let resultUrl = null;
  for (let attempt = 1; attempt <= IMG_MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(IMG_POLL_INTERVAL_MS);
    const pollResp = await fetch(`${JOBS_RECORD_URL}?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) {
      console.warn(`   [kie.ai] img poll ${attempt} → HTTP ${pollResp.status}, retrying`);
      continue;
    }
    const pollJson = await pollResp.json();
    const data = pollJson.data || {};
    // Unified jobs endpoint uses `state` ("success" / "fail" / "waiting" / ...)
    const state = data.state;
    if (state === 'success') {
      let parsed = {};
      try {
        parsed = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : (data.resultJson || {});
      } catch (_) { /* ignore */ }
      resultUrl =
        parsed.resultUrls?.[0] ||
        parsed.result_urls?.[0] ||
        data.response?.resultUrls?.[0] ||
        data.resultUrls?.[0];
      if (!resultUrl) {
        throw new Error(`kie.ai image: state=success but no resultUrls: ${JSON.stringify(data).slice(0, 400)}`);
      }
      console.log(`   [kie.ai] image edit completed after ${attempt} polls`);
      break;
    }
    if (state === 'fail' || state === 'failed') {
      throw new Error(
        `kie.ai image task failed: ${data.failMsg || data.errorMessage || JSON.stringify(data).slice(0, 200)}`
      );
    }
    console.log(`   [kie.ai] img poll ${attempt}/${IMG_MAX_POLL_ATTEMPTS} — state=${state || 'unknown'}`);
  }

  if (!resultUrl) {
    throw new Error(`kie.ai image: timed out after ${IMG_MAX_POLL_ATTEMPTS} polls`);
  }

  // ── Download ──────────────────────────────────────────────────────────
  console.log(`   [kie.ai] downloading ${resultUrl}`);
  const dlResp = await fetch(resultUrl);
  if (!dlResp.ok) {
    throw new Error(`kie.ai image download ${dlResp.status} from ${resultUrl}`);
  }
  const buf = Buffer.from(await dlResp.arrayBuffer());
  await fs.writeFile(outPath, buf);

  // Normalize to exact 1080×1920 via sharp (already in package.json)
  try {
    const sharp = require('sharp');
    const resizedPath = outPath + '.resized.png';
    await sharp(outPath)
      .resize(1080, 1920, { fit: 'cover', position: 'center' })
      .png()
      .toFile(resizedPath);
    await fs.move(resizedPath, outPath, { overwrite: true });
  } catch (err) {
    console.warn(`   [kie.ai] sharp resize skipped: ${err.message}`);
  }

  const finalBuf = await fs.readFile(outPath);
  console.log(`   ✅ ${path.basename(outPath)} (${(finalBuf.length / 1024).toFixed(0)} KB)`);

  return {
    path: outPath,
    sourceUrl: resultUrl,
    _imageEdit: true,
  };
}

module.exports = {
  generateHeroBroll,
  buildCinematicPrompt,
  editCoverImage,
  generateSlothVideo,
  SLOTH_HOOK_PROMPT,
  SLOTH_OUTRO_PROMPT,
};
