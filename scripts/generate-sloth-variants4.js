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
      label: 'V16-underwater',
      ref: refs[0],
      prompt:
        'Transform this image: place this same cute cartoon sloth character inside a submarine recording a deep sea podcast. ' +
        'The sloth sits in a cozy submarine cabin with a round porthole window showing deep ocean with glowing jellyfish and fish outside. ' +
        'Holding bubble tea, talking into a brass vintage microphone, wearing a little captain hat. ' +
        'Blue-green ambient lighting from the ocean. ' +
        'Same character design and cute cartoon art style. Vertical 9:16. ' +
        'No text, no speech bubbles, no words, no logos anywhere.',
    },
    {
      label: 'V17-train',
      ref: refs[1],
      prompt:
        'Transform this image: place this same cute cartoon sloth character on a scenic train recording a travel podcast. ' +
        'The sloth sits by a large train window with beautiful countryside and mountains passing by outside, ' +
        'holding bubble tea, talking into a portable microphone on the tray table. ' +
        'Warm afternoon sunlight streaming through the window, cozy train interior with wooden details. ' +
        'Same character design and cute cartoon art style. Vertical 9:16. ' +
        'No text, no speech bubbles, no words, no logos anywhere.',
    },
    {
      label: 'V18-treehouse',
      ref: refs[2],
      prompt:
        'Transform this image: place this same cute cartoon sloth character in a magical treehouse recording a podcast. ' +
        'The sloth sits on a wooden platform high up in a giant tree, with a rustic microphone setup, ' +
        'holding bubble tea, talking happily. Lush green leaves and vines around, fairy lights hanging from branches, ' +
        'birds and butterflies nearby, golden sunlight filtering through the canopy. ' +
        'Same character design and cute cartoon art style. Vertical 9:16. ' +
        'No text, no speech bubbles, no words, no logos anywhere.',
    },
    {
      label: 'V19-cinema',
      ref: refs[3],
      prompt:
        'Transform this image: place this same cute cartoon sloth character in a vintage movie theater recording a film review podcast. ' +
        'The sloth sits in a red velvet theater seat with a microphone, holding bubble tea and popcorn, ' +
        'talking excitedly about movies. Big cinema screen glowing behind, art deco theater interior with golden decorations. ' +
        'Same character design and cute cartoon art style. Vertical 9:16. ' +
        'No text, no speech bubbles, no words, no logos anywhere.',
    },
    {
      label: 'V20-rainy',
      ref: refs[4],
      prompt:
        'Transform this image: place this same cute cartoon sloth character at a window seat on a rainy day recording a chill podcast. ' +
        'The sloth sits on a window bench with cushions, raindrops on the glass window, ' +
        'holding bubble tea, talking softly into a small desk microphone. ' +
        'Moody cozy atmosphere, warm indoor lighting contrasting with grey rainy cityscape outside, candles on windowsill. ' +
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
