#!/usr/bin/env node
/**
 * generate-short.js — CLI entry for the podcast 40–60s short-video pipeline.
 *
 * Usage:
 *   node scripts/generate-short.js \
 *     --audio=remotion/assets/test-audio.mp3 \
 *     --avatar=remotion/assets/test-cover.jpg \
 *     --title="今天 ChatGPT 進化了一大步" \
 *     --output=remotion/out/short.mp4
 *
 * Defaults to the assets in remotion/assets/ (set up by scripts/fetch-test-assets.js)
 * so you can just run `node scripts/generate-short.js` to do an end-to-end smoke test.
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { runShortsPipeline } = require('../src/services/shortsPipeline');

function parseArgs() {
  const out = {};
  process.argv.slice(2).forEach(arg => {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  });
  return out;
}

async function main() {
  const args = parseArgs();
  const projectRoot = path.join(__dirname, '..');

  // Defaults — fall back to test assets so a bare `node scripts/generate-short.js` works
  const audioPath = path.resolve(
    args.audio || path.join(projectRoot, 'remotion/assets/test-audio.mp3')
  );
  const avatarImagePath = path.resolve(
    args.avatar || path.join(projectRoot, 'remotion/assets/test-cover.jpg')
  );
  const outputPath = args.output
    ? path.resolve(args.output)
    : undefined;
  const episodeTitle = args.title || '';

  if (!fs.existsSync(audioPath)) {
    console.error(`❌ audio not found: ${audioPath}`);
    console.error('   Run: node scripts/fetch-test-assets.js');
    process.exit(1);
  }
  if (!fs.existsSync(avatarImagePath)) {
    console.error(`❌ avatar image not found: ${avatarImagePath}`);
    process.exit(1);
  }

  console.log('🎬 Shorts Pipeline');
  console.log(`   audio:  ${audioPath}`);
  console.log(`   avatar: ${avatarImagePath}`);
  console.log(`   title:  ${episodeTitle || '(none)'}`);

  try {
    const { outputPath: finalPath } = await runShortsPipeline({
      audioPath,
      avatarImagePath,
      episodeTitle,
      outputPath,
    });
    console.log(`\n🎉 Final video: ${finalPath}`);
  } catch (err) {
    console.error('\n❌ Pipeline failed:', err);
    process.exit(1);
  }
}

main();
