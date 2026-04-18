#!/usr/bin/env node
/**
 * generate-short.js — CLI entry for the podcast 40–60s short-video pipeline.
 *
 * All-TTS flow with pre-generated sloth images + Hedra lip-sync:
 *   1. Fetch podcast script from Airtable
 *   2. Show 5 candidate topics → user picks one
 *   3. Run full 7-stage pipeline (randomly picks a sloth avatar image)
 *
 * Usage:
 *   node scripts/generate-short.js              # interactive topic selection
 *   node scripts/generate-short.js --auto       # auto-pick first topic
 *   node scripts/generate-short.js --title="Episode Title"
 *   node scripts/generate-short.js --output=remotion/out/short.mp4
 */

require('dotenv').config();
const path = require('path');
const readline = require('readline');
const { previewTopics, runShortsPipeline } = require('../src/services/shortsPipeline');

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

  console.log('\n🎬 Shorts Pipeline — Setup\n');

  // ── Step 1: Fetch podcast script from Airtable ─────────────────────────
  console.log('📝 Fetching latest podcast script from Airtable...');
  const airtableRow = await fetchFromAirtable();
  const podcastScript = airtableRow?.script || null;
  const episodeTitle = args.title || airtableRow?.title || '';
  const outputPath = args.output ? path.resolve(args.output) : undefined;

  if (podcastScript) {
    console.log(`   ✅ "${episodeTitle}" (${airtableRow.date}, ${podcastScript.length} chars)`);
  } else {
    console.log('   ⚠️  No script found — narration may be limited');
  }

  console.log(`\n📋 Summary:`);
  console.log(`   title: ${episodeTitle || '(none)'}`);

  // ── Step 2: Preview topics ─────────────────────────────────────────────
  console.log('\n━━━ Phase 1: Extracting candidate topics ━━━');
  const { beats } = await previewTopics({
    podcastScript,
    episodeTitle,
  });

  if (!beats || beats.length === 0) {
    console.error('❌ No candidate topics extracted. Check your podcast script.');
    process.exit(1);
  }

  // ── Step 3: User selects a topic ───────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║       請選擇要做成 Shorts 的主題          ║');
  console.log('╚══════════════════════════════════════════╝\n');

  beats.forEach((b, i) => {
    console.log(`  [${i + 1}] ${b.text.slice(0, 80)}...`);
    if (b.reason) console.log(`      💡 ${b.reason}`);
    console.log();
  });

  let selectedBeat;
  if (args.auto) {
    selectedBeat = beats[0];
    console.log(`🤖 Auto mode: selecting topic [1]\n`);
  } else {
    const answer = await ask(`👉 輸入編號 (1-${beats.length}): `);
    const idx = parseInt(answer, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= beats.length) {
      console.error(`❌ Invalid choice: "${answer}". Expected 1-${beats.length}`);
      process.exit(1);
    }
    selectedBeat = beats[idx];
    console.log(`\n✅ Selected topic [${idx + 1}]: ${selectedBeat.text.slice(0, 50)}...\n`);
  }

  // ── Step 4: Cover headline selection ─────────────────────────────────
  console.log('\n━━━ Phase 1.5: Generating cover headline candidates ━━━');
  const { generateCoverHeadlines } = require('../src/services/shortsPipeline/highlightExtractor');
  const headlines = await generateCoverHeadlines({ selectedBeat, narrationScript: null });

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
    console.log(`🤖 Auto mode: selecting headline [1]: ${coverHeadline}\n`);
  } else {
    const hAnswer = await ask(`👉 輸入編號 (1-${headlines.length}): `);
    const hIdx = parseInt(hAnswer, 10) - 1;
    if (isNaN(hIdx) || hIdx < 0 || hIdx >= headlines.length) {
      console.error(`❌ Invalid choice: "${hAnswer}". Expected 1-${headlines.length}`);
      process.exit(1);
    }
    coverHeadline = headlines[hIdx];
    console.log(`\n✅ Selected headline [${hIdx + 1}]: ${coverHeadline}\n`);
  }

  // ── Step 5: Run full pipeline ──────────────────────────────────────────
  console.log('━━━ Phase 2: Generating Short ━━━\n');
  try {
    const { outputPath: finalPath, coverPath } = await runShortsPipeline({
      episodeTitle,
      outputPath,
      podcastScript,
      selectedBeat,
      coverHeadline,
    });
    console.log(`\n🎉 Final video: ${finalPath}`);
    if (coverPath) console.log(`🖼️  Cover image: ${coverPath}`);
  } catch (err) {
    console.error('\n❌ Pipeline failed:', err);
    process.exit(1);
  }
}

main();
