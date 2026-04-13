#!/usr/bin/env node
/**
 * generate-sloth-avatar.js — One-off script to generate a clean sloth avatar
 * image (in recording studio, no text) from IG reference images via kie.ai.
 *
 * Usage:
 *   node scripts/generate-sloth-avatar.js
 *
 * Output: remotion/public/sloth_studio.png
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
  const resp = await fetch('https://tmpfiles.org/api/v1/upload', {
    method: 'POST',
    body: form,
  });
  if (!resp.ok) throw new Error(`tmpfiles.org upload ${resp.status}`);
  const json = await resp.json();
  const viewUrl = json?.data?.url;
  if (!viewUrl) throw new Error(`tmpfiles.org unexpected: ${JSON.stringify(json)}`);
  return viewUrl.replace('://tmpfiles.org/', '://tmpfiles.org/dl/');
}

async function main() {
  const apiKey = process.env.KIE_AI_API_KEY;
  if (!apiKey) {
    console.error('KIE_AI_API_KEY not set');
    process.exit(1);
  }

  // Use the clearest front-facing reference image
  const refImage = path.join(__dirname, '..', 'remotion', 'lanrenbao_ig_photos', 'AI懶人報用圖_2026-04-05_801.png');
  console.log(`Reference image: ${path.basename(refImage)}`);

  console.log('\nUploading reference image to tmpfiles.org...');
  const imageUrls = [await uploadToTmpFiles(refImage)];
  console.log(`  ✅ ${imageUrls[0]}`);

  const prompt =
    'Transform this image: place this same cute cartoon sloth character in a cozy podcast recording studio. ' +
    'The sloth sits at a desk with a professional microphone, wearing headphones around its neck, ' +
    'holding bubble tea in one hand, gesturing with the other while talking. ' +
    'Warm studio lighting, acoustic foam panels on walls. ' +
    'Same character design and art style. Vertical 9:16 framing. ' +
    'No text, no speech bubbles, no words, no logos anywhere.';

  console.log(`\nSubmitting kie.ai nano-banana-edit job with ${imageUrls.length} reference images...`);
  console.log(`Prompt: ${prompt.slice(0, 120)}...`);

  const submitResp = await fetch(JOBS_CREATE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: NANO_BANANA_EDIT_MODEL,
      input: {
        prompt,
        image_urls: imageUrls,
        image_size: '9:16',
        output_format: 'png',
      },
    }),
  });

  if (!submitResp.ok) {
    const errText = await submitResp.text().catch(() => '');
    console.error(`Submit failed ${submitResp.status}: ${errText}`);
    process.exit(1);
  }
  const submitJson = await submitResp.json();
  if (submitJson.code !== 200 || !submitJson.data?.taskId) {
    console.error(`Unexpected response: ${JSON.stringify(submitJson)}`);
    process.exit(1);
  }
  const taskId = submitJson.data.taskId;
  console.log(`taskId: ${taskId}`);

  // Poll
  let resultUrl = null;
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    const pollResp = await fetch(`${JOBS_RECORD_URL}?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) {
      console.warn(`poll ${attempt} → HTTP ${pollResp.status}, retrying`);
      continue;
    }
    const pollJson = await pollResp.json();
    const data = pollJson.data || {};
    const state = data.state;
    if (state === 'success') {
      let parsed = {};
      try {
        parsed = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : (data.resultJson || {});
      } catch (_) {}
      resultUrl =
        parsed.resultUrls?.[0] ||
        parsed.result_urls?.[0] ||
        data.response?.resultUrls?.[0] ||
        data.resultUrls?.[0];
      if (!resultUrl) {
        console.error(`success but no resultUrls: ${JSON.stringify(data).slice(0, 400)}`);
        process.exit(1);
      }
      console.log(`\nCompleted after ${attempt} polls!`);
      break;
    }
    if (state === 'fail' || state === 'failed') {
      console.error(`Task failed: ${data.failMsg || data.errorMessage || JSON.stringify(data).slice(0, 200)}`);
      process.exit(1);
    }
    console.log(`poll ${attempt}/${MAX_POLL_ATTEMPTS} — state=${state || 'unknown'}`);
  }

  if (!resultUrl) {
    console.error('Timed out');
    process.exit(1);
  }

  // Download
  const outPath = path.join(__dirname, '..', 'remotion', 'public', 'sloth_studio.png');
  await fs.ensureDir(path.dirname(outPath));
  console.log(`Downloading ${resultUrl}`);
  const dlResp = await fetch(resultUrl);
  if (!dlResp.ok) {
    console.error(`Download failed ${dlResp.status}`);
    process.exit(1);
  }
  const buf = Buffer.from(await dlResp.arrayBuffer());
  await fs.writeFile(outPath, buf);

  // Resize to 1080x1920
  try {
    const sharp = require('sharp');
    const resizedPath = outPath + '.resized.png';
    await sharp(outPath)
      .resize(1080, 1920, { fit: 'cover', position: 'center' })
      .png()
      .toFile(resizedPath);
    await fs.move(resizedPath, outPath, { overwrite: true });
  } catch (err) {
    console.warn(`sharp resize skipped: ${err.message}`);
  }

  const finalBuf = await fs.readFile(outPath);
  console.log(`\n✅ Saved: ${outPath} (${(finalBuf.length / 1024).toFixed(0)} KB)`);
  console.log('You can now use this as the avatar image for the shorts pipeline.');
}

main();
