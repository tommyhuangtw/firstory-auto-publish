#!/usr/bin/env node
/**
 * generate-cover.js — Standalone CLI for generating IG Reels cover images.
 *
 * Runs only the cover-related steps (no TTS, no video, no B-roll):
 *   1. Fetch podcast script from Airtable
 *   2. Extract essence beats → user picks a topic
 *   3. Generate 5 cover headlines → user picks one
 *   4. Render cover image via Remotion Still
 *
 * Usage:
 *   node scripts/generate-cover.js              # interactive
 *   node scripts/generate-cover.js --auto       # auto-pick first options
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs-extra');
const readline = require('readline');
const {
  previewTopics,
  pickRandomSlothImage,
  renderRemotionStill,
  stageAsset,
  rel,
  REMOTION_DIR,
} = require('../src/services/shortsPipeline');
const { generateCoverHeadlines } = require('../src/services/shortsPipeline/highlightExtractor');

function parseArgs() {
  const out = {};
  process.argv.slice(2).forEach(arg => {
    if (arg === '--auto') { out.auto = true; return; }
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  });
  return out;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function fetchFromAirtable() {
  if (!process.env.AIRTABLE_API_KEY) {
    console.warn('   AIRTABLE_API_KEY not set — cannot fetch podcast script');
    return null;
  }
  const { AirtableService } = require('../src/services/airtable');
  const at = new AirtableService();
  const row = await at.getLatestPodcastScript();
  if (!row || !row.script) {
    console.warn('   No podcast script found in Airtable');
    return null;
  }
  return row;
}

async function main() {
  const args = parseArgs();

  console.log('\n🖼️  Reels Cover Generator\n');

  // ── Step 1: Fetch podcast script ────────────────────────────────────────
  console.log('📝 Fetching latest podcast script from Airtable...');
  const airtableRow = await fetchFromAirtable();
  const podcastScript = airtableRow?.script || null;
  const episodeTitle = args.title || airtableRow?.title || '';

  if (podcastScript) {
    console.log(`   ✅ "${episodeTitle}" (${airtableRow.date}, ${podcastScript.length} chars)`);
  } else {
    console.log('   ⚠️  No script found');
  }

  // ── Step 2: Extract essence beats → user picks topic ────────────────────
  console.log('\n━━━ Step 1: Extracting candidate topics ━━━');
  const { beats } = await previewTopics({ podcastScript, episodeTitle });

  if (!beats || beats.length === 0) {
    console.error('❌ No candidate topics extracted.');
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║       請選擇主題                          ║');
  console.log('╚══════════════════════════════════════════╝\n');

  beats.forEach((b, i) => {
    console.log(`  [${i + 1}] ${b.text.slice(0, 80)}...`);
    if (b.reason) console.log(`      💡 ${b.reason}`);
    console.log();
  });

  let selectedBeat;
  if (args.auto) {
    selectedBeat = beats[0];
    console.log(`🤖 Auto: selecting topic [1]\n`);
  } else {
    const answer = await ask(`👉 輸入編號 (1-${beats.length}): `);
    const idx = parseInt(answer, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= beats.length) {
      console.error(`❌ Invalid choice: "${answer}".`);
      process.exit(1);
    }
    selectedBeat = beats[idx];
    console.log(`\n✅ Selected topic [${idx + 1}]\n`);
  }

  // ── Step 3: Generate cover headlines → user picks one ───────────────────
  console.log('━━━ Step 2: Generating cover headline candidates ━━━');
  const headlines = await generateCoverHeadlines({ selectedBeat });

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║       請選擇 Reels 封面標題               ║');
  console.log('╚══════════════════════════════════════════╝\n');

  headlines.forEach((h, i) => {
    console.log(`  [${i + 1}] ${h}`);
  });
  console.log();

  let coverHeadline;
  if (args.auto) {
    coverHeadline = headlines[0];
    console.log(`🤖 Auto: selecting headline [1]: ${coverHeadline}\n`);
  } else {
    const hAnswer = await ask(`👉 輸入編號 (1-${headlines.length}): `);
    const hIdx = parseInt(hAnswer, 10) - 1;
    if (isNaN(hIdx) || hIdx < 0 || hIdx >= headlines.length) {
      console.error(`❌ Invalid choice: "${hAnswer}".`);
      process.exit(1);
    }
    coverHeadline = headlines[hIdx];
    console.log(`\n✅ Selected: ${coverHeadline}\n`);
  }

  // ── Step 4: Render cover image ──────────────────────────────────────────
  console.log('━━━ Step 3: Rendering cover image ━━━');
  const avatarImagePath = pickRandomSlothImage();
  console.log(`   🦥 Background: ${path.basename(avatarImagePath)}`);

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const stageDir = path.join(REMOTION_DIR, 'public', `cover_${ts}`);
  await fs.ensureDir(stageDir);

  const outputDir = path.join(REMOTION_DIR, 'out');
  await fs.ensureDir(outputDir);
  const coverPath = path.join(outputDir, `cover_${ts}.png`);

  try {
    const stagedAvatar = await stageAsset(avatarImagePath, stageDir, 'avatar' + path.extname(avatarImagePath));
    const coverProps = {
      headline: coverHeadline,
      backgroundImageSrc: rel(stagedAvatar),
    };
    const propsPath = path.join(stageDir, 'cover_props.json');
    await fs.writeJSON(propsPath, coverProps, { spaces: 2 });

    await renderRemotionStill({ propsPath, outputPath: coverPath });
  } finally {
    await fs.remove(stageDir).catch(() => {});
  }

  console.log(`\n🎉 Cover image: ${coverPath}`);
}

main().catch(err => {
  console.error('\n❌ Failed:', err);
  process.exit(1);
});
