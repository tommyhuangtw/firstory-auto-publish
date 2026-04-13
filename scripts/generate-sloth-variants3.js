#!/usr/bin/env node
require('dotenv').config();
const path = require('path');
const fs = require('fs-extra');

const KIE_BASE = 'https://api.kie.ai';
const JOBS_CREATE_URL = `${KIE_BASE}/api/v1/jobs/createTask`;
const JOBS_RECORD_URL = `${KIE_BASE}/api/v1/jobs/recordInfo`;
const MODEL = 'google/nano-banana-edit';
const POLL_MS = 5_000;
const MAX_POLL = 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function uploadToTmpFiles(imagePath) {
  const buf = await fs.readFile(imagePath);
  const form = new FormData();
  form.append('file', new Blob([buf]), path.basename(imagePath));
  const resp = await fetch('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: form });
  if (!resp.ok) throw new Error(`tmpfiles.org ${resp.status}`);
  const json = await resp.json();
  return json?.data?.url?.replace('://tmpfiles.org/', '://tmpfiles.org/dl/');
}

async function gen({ apiKey, imageUrl, prompt, outPath, label }) {
  console.log(`[${label}] Submitting...`);
  const r = await fetch(JOBS_CREATE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: { prompt, image_urls: [imageUrl], image_size: '9:16', output_format: 'png' } }),
  });
  if (!r.ok) throw new Error(`[${label}] submit ${r.status}`);
  const j = await r.json();
  if (j.code !== 200 || !j.data?.taskId) throw new Error(`[${label}] bad response`);
  const taskId = j.data.taskId;
  console.log(`[${label}] taskId: ${taskId}`);

  let url = null;
  for (let i = 1; i <= MAX_POLL; i++) {
    await sleep(POLL_MS);
    const p = await fetch(`${JOBS_RECORD_URL}?taskId=${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!p.ok) continue;
    const d = (await p.json()).data || {};
    if (d.state === 'success') {
      let parsed = {};
      try { parsed = typeof d.resultJson === 'string' ? JSON.parse(d.resultJson) : (d.resultJson || {}); } catch (_) {}
      url = parsed.resultUrls?.[0] || parsed.result_urls?.[0] || d.response?.resultUrls?.[0];
      if (!url) throw new Error(`[${label}] no URL`);
      console.log(`[${label}] ✅ done (${i} polls)`);
      break;
    }
    if (d.state === 'fail' || d.state === 'failed') throw new Error(`[${label}] failed: ${d.failMsg || d.errorMessage}`);
    if (i % 10 === 0) console.log(`[${label}] poll ${i}/${MAX_POLL}...`);
  }
  if (!url) throw new Error(`[${label}] timed out`);

  const dl = await fetch(url);
  const buf = Buffer.from(await dl.arrayBuffer());
  await fs.ensureDir(path.dirname(outPath));
  await fs.writeFile(outPath, buf);
  try {
    const sharp = require('sharp');
    const tmp = outPath + '.tmp.png';
    await sharp(outPath).resize(1080, 1920, { fit: 'cover', position: 'center' }).png().toFile(tmp);
    await fs.move(tmp, outPath, { overwrite: true });
  } catch (_) {}
  console.log(`[${label}] saved: ${path.basename(outPath)}`);
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
      label: 'V11-library',
      ref: refs[0],
      prompt:
        'Transform this image: place this same cute cartoon sloth character in a grand old library recording a podcast. ' +
        'The sloth sits in a leather armchair with a vintage desk microphone, holding bubble tea, ' +
        'talking with one hand gesturing. Tall wooden bookshelves floor to ceiling, warm reading lamps, sunlight through arched windows. ' +
        'Same character design and cute cartoon art style. Vertical 9:16. ' +
        'No text, no speech bubbles, no words, no logos anywhere.',
    },
    {
      label: 'V12-space',
      ref: refs[1],
      prompt:
        'Transform this image: place this same cute cartoon sloth character inside a spaceship cockpit recording a podcast. ' +
        'The sloth floats slightly in zero gravity in a space suit (helmet off), holding bubble tea that floats too, ' +
        'talking into a futuristic holographic microphone. Stars and Earth visible through the cockpit window. ' +
        'Same character design and cute cartoon art style. Vertical 9:16. ' +
        'No text, no speech bubbles, no words, no logos anywhere.',
    },
    {
      label: 'V13-garden',
      ref: refs[2],
      prompt:
        'Transform this image: place this same cute cartoon sloth character in a beautiful Japanese zen garden recording a podcast. ' +
        'The sloth sits on a wooden engawa (veranda) with a microphone, holding bubble tea, ' +
        'talking peacefully. Cherry blossom trees, koi pond, stone lantern, soft morning light. ' +
        'Same character design and cute cartoon art style. Vertical 9:16. ' +
        'No text, no speech bubbles, no words, no logos anywhere.',
    },
    {
      label: 'V14-kitchen',
      ref: refs[3],
      prompt:
        'Transform this image: place this same cute cartoon sloth character in a cozy kitchen recording a cooking podcast. ' +
        'The sloth stands at a kitchen counter with a microphone on a stand, wearing a cute apron, ' +
        'holding bubble tea in one hand, the other hand showing ingredients. Warm kitchen with pots, plants, and wooden shelves. ' +
        'Same character design and cute cartoon art style. Vertical 9:16. ' +
        'No text, no speech bubbles, no words, no logos anywhere.',
    },
    {
      label: 'V15-van',
      ref: refs[4],
      prompt:
        'Transform this image: place this same cute cartoon sloth character inside a cozy camper van recording a travel podcast. ' +
        'The sloth sits on a cushioned bench inside a converted van with fairy lights, a small desk microphone, ' +
        'holding bubble tea, talking cheerfully. Van door open showing mountain scenery and sunset outside. ' +
        'Same character design and cute cartoon art style. Vertical 9:16. ' +
        'No text, no speech bubbles, no words, no logos anywhere.',
    },
  ];

  console.log('Uploading reference images...');
  const urlMap = {};
  for (const v of variants) {
    if (!urlMap[v.ref]) {
      urlMap[v.ref] = await uploadToTmpFiles(path.join(igDir, v.ref));
      console.log(`  ✅ ${v.ref}`);
    }
  }

  console.log('\nGenerating 5 variants in parallel...\n');
  const results = await Promise.allSettled(
    variants.map(v => gen({ apiKey, imageUrl: urlMap[v.ref], prompt: v.prompt, outPath: path.join(outDir, `sloth_studio_${v.label}.png`), label: v.label }))
  );

  console.log('\n━━━ Results ━━━');
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') console.log(`  ✅ ${variants[i].label}`);
    else console.log(`  ❌ ${variants[i].label}: ${r.reason.message}`);
  });
}

main();
