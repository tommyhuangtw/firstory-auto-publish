#!/usr/bin/env node
/**
 * Generate 4 sloth studio avatar variants in parallel via kie.ai.
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
  console.log(`\n[${label}] Submitting...`);
  console.log(`  prompt: ${prompt.slice(0, 80)}...`);

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
  console.log(`[${label}] saved: ${outPath} (${(final.length / 1024).toFixed(0)} KB)`);
}

async function main() {
  const apiKey = process.env.KIE_AI_API_KEY;
  if (!apiKey) { console.error('KIE_AI_API_KEY not set'); process.exit(1); }

  const igDir = path.join(__dirname, '..', 'remotion', 'lanrenbao_ig_photos');
  const outDir = path.join(__dirname, '..', 'remotion', 'public');

  // Use different reference images for variety
  const refs = [
    'AI懶人報用圖_2026-04-03_919.png',  // sloth on train
    'AI懶人報用圖_2026-04-08_370.png',  // sloth on bench
    'AI懶人報用圖_2026-04-09_114.png',  // sloth with robot
    '0329週日懶人報IG圖.png',            // sloth in bed
  ];

  const variants = [
    {
      label: 'V2-warm',
      ref: refs[0],
      prompt:
        'Transform this image: place this same cute cartoon sloth character in a warm home podcast studio. ' +
        'The sloth sits in a comfy chair behind a desk with a condenser microphone on a boom arm, ' +
        'holding bubble tea, smiling and talking into the mic. ' +
        'Warm orange desk lamp, bookshelf with books in background, cozy atmosphere. ' +
        'Same character design and cute cartoon art style. Vertical 9:16. ' +
        'No text, no speech bubbles, no words, no logos, no characters anywhere in the image.',
    },
    {
      label: 'V3-pro',
      ref: refs[1],
      prompt:
        'Transform this image: place this same cute cartoon sloth character in a professional radio broadcasting booth. ' +
        'The sloth wears over-ear headphones on its head, sitting at a broadcast desk with a large studio microphone, ' +
        'holding bubble tea, one hand raised while explaining something excitedly. ' +
        'Background: soundproof studio with LED strip lights in purple/blue, mixing console visible. ' +
        'Same character design and cute cartoon art style. Vertical 9:16. ' +
        'No text, no speech bubbles, no words, no logos anywhere.',
    },
    {
      label: 'V4-minimal',
      ref: refs[2],
      prompt:
        'Transform this image: place this same cute cartoon sloth character recording a podcast in a minimalist white studio. ' +
        'The sloth sits on a modern stool with a sleek microphone on a stand in front, ' +
        'holding bubble tea, looking at camera with a friendly expression, gesturing with one hand. ' +
        'Clean white background with soft shadows, simple and elegant setup. ' +
        'Same character design and cute cartoon art style. Vertical 9:16. ' +
        'No text, no speech bubbles, no words, no logos anywhere.',
    },
    {
      label: 'V5-night',
      ref: refs[3],
      prompt:
        'Transform this image: place this same cute cartoon sloth character in a late-night cozy podcast studio. ' +
        'The sloth sits at a wooden desk with a vintage-style microphone, wearing a cozy hoodie, ' +
        'holding bubble tea, talking animatedly with one hand gesturing. ' +
        'Night time atmosphere: warm lamp light, window showing city lights at night, acoustic panels on wall. ' +
        'Same character design and cute cartoon art style. Vertical 9:16. ' +
        'No text, no speech bubbles, no words, no logos anywhere.',
    },
  ];

  // Upload all reference images first
  console.log('Uploading reference images...');
  const urlMap = {};
  for (const v of variants) {
    if (!urlMap[v.ref]) {
      const imgPath = path.join(igDir, v.ref);
      urlMap[v.ref] = await uploadToTmpFiles(imgPath);
      console.log(`  ✅ ${v.ref}`);
    }
  }

  // Run all 4 in parallel
  console.log('\nGenerating 4 variants in parallel...\n');
  const results = await Promise.allSettled(
    variants.map((v, i) =>
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
    if (r.status === 'fulfilled') {
      console.log(`  ✅ ${variants[i].label}: success`);
    } else {
      console.log(`  ❌ ${variants[i].label}: ${r.reason.message}`);
    }
  });
}

main();
