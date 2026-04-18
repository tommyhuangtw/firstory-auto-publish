#!/usr/bin/env node
/**
 * One-shot helper: pull a small podcast audio + a cover image from Google Drive
 * into remotion/assets/ for shorts pipeline testing.
 *
 * Strategy:
 *   - List files in AUDIO_FOLDER_ID, sort by size ascending, pick the smallest mp3.
 *   - List files in COVER_FOLDER_ID, pick the most recent image.
 *
 * Reuses GoogleDriveService auth (OAuth tokens already cached at temp/google-tokens.json).
 *
 * Usage:
 *   node scripts/fetch-test-assets.js
 */

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const { GoogleDriveService } = require('../src/services/googleDrive');

const ASSETS_DIR = path.join(__dirname, '..', 'remotion', 'assets');

async function main() {
  await fs.ensureDir(ASSETS_DIR);
  const drive = new GoogleDriveService();
  await drive.initializeAuth();

  // ---- Audio: list & pick smallest mp3 ----
  console.log('\n🔎 Listing audio folder...');
  const audioListResp = await drive.drive.files.list({
    q: `'${drive.AUDIO_FOLDER_ID}' in parents and trashed = false and mimeType contains 'audio'`,
    fields: 'files(id, name, mimeType, modifiedTime, size)',
    orderBy: 'modifiedTime desc',
    pageSize: 50,
  });
  // Filter to sane sizes: 3 MB ≤ size ≤ 30 MB. Anything tiny is likely a corrupt
  // upload (we saw multiple 56KB duplicates), and >30MB takes too long to test with.
  const MIN = 3 * 1024 * 1024;
  const MAX = 30 * 1024 * 1024;
  const allAudio = (audioListResp.data.files || []).filter(f => f.size);
  const audioFiles = allAudio.filter(f => Number(f.size) >= MIN && Number(f.size) <= MAX);
  if (!audioFiles.length) {
    throw new Error(`No audio in 3–30MB range. Total: ${allAudio.length}`);
  }

  // Pick the *smallest within the sane range* so test runs are fast
  audioFiles.sort((a, b) => Number(a.size) - Number(b.size));
  console.log(`📊 ${audioFiles.length} audio files in 3–30MB range. Smallest 5:`);
  audioFiles.slice(0, 5).forEach((f, i) => {
    console.log(`  ${i + 1}. ${f.name}  (${(Number(f.size) / 1024 / 1024).toFixed(1)} MB)`);
  });
  const pickedAudio = audioFiles[0];
  console.log(`✅ Picking smallest: ${pickedAudio.name}`);

  // ---- Cover: pick most recent image ----
  console.log('\n🔎 Listing cover folder...');
  const coverListResp = await drive.drive.files.list({
    q: `'${drive.COVER_FOLDER_ID}' in parents and trashed = false and mimeType contains 'image'`,
    fields: 'files(id, name, mimeType, modifiedTime, size)',
    orderBy: 'modifiedTime desc',
    pageSize: 10,
  });
  const coverFiles = coverListResp.data.files || [];
  if (!coverFiles.length) throw new Error('No image files found in COVER_FOLDER_ID');
  const pickedCover = coverFiles[0];
  console.log(`✅ Picking most recent cover: ${pickedCover.name}`);

  // ---- Download both directly into remotion/assets ----
  // Drive files often lack a .mp3/.jpg extension in the filename. Infer from MIME.
  const audioExt = mimeToExt(pickedAudio.mimeType, '.mp3');
  const coverExt = mimeToExt(pickedCover.mimeType, '.jpg');

  console.log('\n⬇️  Downloading audio...');
  const audioDest = path.join(ASSETS_DIR, 'test-audio' + audioExt);
  await downloadById(drive, pickedAudio.id, audioDest);

  console.log('\n⬇️  Downloading cover...');
  const coverDest = path.join(ASSETS_DIR, 'test-cover' + coverExt);
  await downloadById(drive, pickedCover.id, coverDest);

  // ---- Write a manifest so other scripts can pick these up ----
  const manifest = {
    fetchedAt: new Date().toISOString(),
    audio: {
      drivePath: pickedAudio.name,
      driveId: pickedAudio.id,
      sizeBytes: Number(pickedAudio.size),
      localPath: path.relative(path.join(__dirname, '..'), audioDest),
    },
    cover: {
      drivePath: pickedCover.name,
      driveId: pickedCover.id,
      localPath: path.relative(path.join(__dirname, '..'), coverDest),
    },
  };
  await fs.writeJSON(path.join(ASSETS_DIR, 'manifest.json'), manifest, { spaces: 2 });

  console.log('\n✅ Done. Assets saved to remotion/assets/');
  console.log(JSON.stringify(manifest, null, 2));
}

function mimeToExt(mime, fallback) {
  if (!mime) return fallback;
  const map = {
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/m4a': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/mp4': '.m4a',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
  };
  return map[mime] || fallback;
}

async function downloadById(drive, fileId, destPath) {
  const resp = await drive.drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(destPath);
    resp.data.pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
  });
  const stat = fs.statSync(destPath);
  console.log(`   ✅ ${destPath} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch(err => {
  console.error('❌ fetch-test-assets failed:', err);
  process.exit(1);
});
