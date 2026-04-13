#!/usr/bin/env node
/**
 * Generate 5 more sloth studio avatar variants in parallel via kie.ai.
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs-extra');

const KIE_BASE = 'https://api.kie.ai';
const JOBS_CREATE_URL = `${KIE_BASE}/api/v1/jobs/createTask`;
const JOBS_RECORD_URL = `${KIE_BASE}/api/v1/jobs/recordInfo`;
const NANO_BANANA_EDIT_MODEL = 'google/nano-banana-edit';
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function uploadToTmpFiles(imagePath) {
  const buf = await fs.readFile(imagePath);
  const form = new FormData();
  const blob = new Blob([buf]);
  form.append('file', blob, path.basename(imagePath));
  const resp = await fetch('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: form });
  if (!resp.ok) throw new Error(`tmpfiles.org upload ${resp.status}`);
  const json = await resp.json();
  const viewUrl = json?.data?.url;
  if (!viewUrl) throw new Error(`tmpfiles.org unexpected: ${JSON.stringify(json)}`);
  return viewUrl.replace('://tmpfiles.org/', '://tmpfiles.org/dl/');
}

async function generateVariant({ apiKey, imageUrl, prompt, outPath, label }) {
  console.log(`[${label}] Submitting...`);

  const submitResp = await fetch(JOBS_CREATE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: NANO_BANANA_EDIT_MODEL,
      input: { prompt, image_urls: [imageUrl], image_size: '9:16', output_format: 'png' },
    }),
  });
  if (!submitResp.ok) throw new Error(`[${label}] submit ${submitResp.status}`);
  const submitJson = await submitResp.json();
  if (submitJson.code !== 200 || !submitJson.data?.taskId) throw new Error(`[${label}] bad response`);
  const taskId = submitJson.data.taskId;
  console.log(`[${label}] taskId: ${taskId}`);

  let resultUrl = null;
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    const pollResp = await fetch(`${JOBS_RECORD_URL}?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollJson = await pollResp.json();
    const data = pollJson.data || {};
    if (data.state === 'success') {
      let parsed = {};
      try { parsed = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : (data.resultJson || {}); } catch (_) {}
      resultUrl = parsed.resultUrls?.[0] || parsed.result_urls?.[0] || data.response?.resultUrls?.[0] || data.resultUrls?.[0];
      if (!resultUrl) throw new Error(`[${label}] success but no URL`);
      console.log(`[${label}] ✅ completed after ${attempt} polls`);
      break;
    }
    if (data.state === 'fail' || data.state === 'failed') {
      throw new Error(`[${label}] failed: ${data.failMsg || data.errorMessage || 'unknown'}`);
    }
    if (attempt % 10 === 0) console.log(`[${label}] poll ${attempt}/${MAX_POLL_ATTEMPTS}...`);
  }
  if (!resultUrl) throw new Error(`[${label}] timed out`);

  const dlResp = await fetch(resultUrl);
  if (!dlResp.ok) throw new Error(`[${label}] download ${dlResp.status}`);
  const buf = Buffer.from(await dlResp.arrayBuffer());
  await fs.ensureDir(path.dirname(outPath));
  await fs.writeFile(outPath, buf);

  try {
    const sharp = require('sharp');
    const tmp = outPath + '.tmp.png';
    await sharp(outPath).resize(1080, 1920, { fit: 'cover', position: 'center' }).png().toFile(tmp);
    await fs.move(tmp, outPath, { overwrite: true });
  } catch (_) {}

  const final = await fs.readFile(outPath);
  console.log(`[${label}] saved: ${path.basename(outPath)} (${(final.length / 1024).toFixed(0)} KB)`);
}

async function main() {
  const apiKey = process.env.KIE_AI_API_KEY;
  if (!apiKey) { console.error('KIE_AI_API_KEY not set'); process.exit(1); }

  const igDir = path.join(__dirname, '..', 'remotion', 'lanrenbao_ig_photos');
  const outDir = path.join(__dirname, '..', 'remotion', 'public');

  const refs = [
    'AI懶人報用圖_2026-04-05_801.png',
    'AI懶人報用圖_2026-04-03_919.png',
    'AI懶人報用圖_2026-04-09_114.png',
    'AI懶人報用圖_2026-04-08_370.png',
    '0329週日懶人報IG圖.png',
  ];

  const variants = [
    {
      label: 'V6-cafe',
      ref: refs[0],
      prompt:
        'Transform this image: place this same cute cartoon sloth character in a trendy cafe doing a podcast live stream. ' +
        'The sloth sits at a cafe table with a portable microphone and laptop, holding bubble tea, ' +
        'talking cheerfully with one hand waving. Cafe background with warm string lights, plants, and coffee cups. ' +
        'Same character design and cute cartoon art style. Vertical 9:16. ' +
        'No text, no speech bubbles, no words, no logos anywhere.',
    },
    {
      label: 'V7-retro',
      ref: refs[1],
      prompt:
        'Transform this image: place this same cute cartoon sloth character in a vintage retro radio station studio from the 1970s. ' +
        'The sloth sits at an old wooden broadcast desk with a classic chrome microphone, wearing big retro headphones, ' +
        'holding bubble tea, smiling and talking. Background: wood paneling, vintage radio equipment, vinyl records on shelf, warm amber lighting. ' +
        'Same character design and cute cartoon art style. Vertical 9:16. ' +
        'No text, no speech bubbles, no words, no logos anywhere.',
    },
    {
      label: 'V8-outdoor',
      ref: refs[2],
      prompt:
        'Transform this image: place this same cute cartoon sloth character recording a podcast outdoors on a rooftop at sunset. ' +
        'The sloth sits on a folding chair with a portable mic setup on a small table, holding bubble tea, ' +
        'talking and gesturing with city skyline and orange sunset sky behind. Warm golden hour light. ' +
        'Same character design and cute cartoon art style. Vertical 9:16. ' +
        'No text, no speech bubbles, no words, no logos anywhere.',
    },
    {
      label: 'V9-gaming',
      ref: refs[3],
      prompt:
        'Transform this image: place this same cute cartoon sloth character in a gaming/streaming setup room doing a podcast. ' +
        'The sloth sits in a gaming chair with RGB lights, studio microphone on boom arm, dual monitors behind showing colorful screens, ' +
        'holding bubble tea, talking excitedly with one hand raised. Neon blue and pink ambient lighting. ' +
        'Same character design and cute cartoon art style. Vertical 9:16. ' +
        'No text, no speech bubbles, no words, no logos anywhere.',
    },
    {
      label: 'V10-cozy',
      ref: refs[4],
      prompt:
        'Transform this image: place this same cute cartoon sloth character recording a podcast in bed, cozy ASMR style. ' +
        'The sloth is propped up against fluffy pillows with a blanket, holding bubble tea, ' +
        'talking softly into a cute desk microphone on a bed tray table. ' +
        'Cozy bedroom with fairy lights, plushies, warm dim lighting, rainy window in background. ' +
        'Same character design and cute cartoon art style. Vertical 9:16. ' +
        'No text, no speech bubbles, no words, no logos anywhere.',
    },
  ];

  // Upload references
  console.log('Uploading reference images...');
  const urlMap = {};
  for (const v of variants) {
    if (!urlMap[v.ref]) {
      urlMap[v.ref] = await uploadToTmpFiles(path.join(igDir, v.ref));
      console.log(`  ✅ ${v.ref}`);
    }
  }

  // Run all 5 in parallel
  console.log('\nGenerating 5 variants in parallel...\n');
  const results = await Promise.allSettled(
    variants.map(v =>
      generateVariant({
        apiKey,
        imageUrl: urlMap[v.ref],
        prompt: v.prompt,
        outPath: path.join(outDir, `sloth_studio_${v.label}.png`),
        label: v.label,
      })
    )
  );

  console.log('\n━━━ Results ━━━');
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') console.log(`  ✅ ${variants[i].label}: success`);
    else console.log(`  ❌ ${variants[i].label}: ${r.reason.message}`);
  });
}

main();
