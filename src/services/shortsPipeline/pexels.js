/**
 * pexels.js — Search & download royalty-free B-roll videos from Pexels.
 *
 * Docs: https://www.pexels.com/api/documentation/#videos
 *
 * Until PEXELS_API_KEY is set, generates simple ffmpeg-lavfi gradient clips
 * so the Remotion BRollLayer can still be exercised end-to-end in dev.
 */

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const PEXELS_API = 'https://api.pexels.com/videos/search';

// Gradient palette cycled through when stubbing dev-mode B-roll.
const STUB_GRADIENTS = [
  ['0x1a1a3a', '0x7e3ff2'],
  ['0x0a4a6a', '0x2ec4b6'],
  ['0x3a0a1a', '0xff6b6b'],
  ['0x2a1a0a', '0xffa94d'],
  ['0x0a2a0a', '0x51cf66'],
  ['0x1a0a2a', '0xd6336c'],
];

/**
 * Search Pexels for B-roll matching a keyword and download the best vertical
 * (or square) clip.
 *
 * @param {object} args
 * @param {string} args.keyword
 * @param {string} args.outDir
 * @param {number} [args.minDurationSec=8]
 * @param {string} [args.orientation='portrait']
 * @returns {Promise<{ path: string, sourceUrl: string, photographer: string } | null>}
 */
async function searchAndDownload({ keyword, outDir, minDurationSec = 8, orientation = 'portrait', stubIndex = 0 }) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.warn(`⚠️  [pexels] PEXELS_API_KEY not set — generating STUB gradient for "${keyword}"`);
    return makeStubClip({ keyword, outDir, stubIndex });
  }

  const params = new URLSearchParams({
    query: keyword,
    per_page: '10',
    orientation,
  });

  const resp = await fetch(`${PEXELS_API}?${params}`, {
    headers: { Authorization: apiKey },
  });
  if (!resp.ok) {
    console.warn(`[pexels] search failed (${resp.status}) for "${keyword}"`);
    return null;
  }

  const data = await resp.json();
  const videos = (data.videos || []).filter(v => v.duration >= minDurationSec);
  if (!videos.length) {
    console.warn(`[pexels] no videos ≥${minDurationSec}s for "${keyword}"`);
    return null;
  }

  // Pick the first; prefer 1080p HD file
  const video = videos[0];
  const file =
    video.video_files.find(f => f.quality === 'hd' && f.width >= 720) ||
    video.video_files[0];

  await fs.ensureDir(outDir);
  const safeName = keyword.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const dest = path.join(outDir, `broll_${safeName}_${video.id}.mp4`);

  const dl = await fetch(file.link);
  const buf = Buffer.from(await dl.arrayBuffer());
  await fs.writeFile(dest, buf);

  console.log(`   ✅ pexels "${keyword}" → ${path.basename(dest)} (${video.duration}s, by ${video.user?.name})`);
  return {
    path: dest,
    sourceUrl: video.url,
    photographer: video.user?.name || 'unknown',
  };
}

/**
 * Download one B-roll per keyword (best-effort; missing ones are skipped).
 * @param {string[]} keywords
 * @param {string} outDir
 */
async function fetchAll(keywords, outDir) {
  const results = [];
  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    try {
      const r = await searchAndDownload({ keyword: kw, outDir, stubIndex: i });
      if (r) results.push({ keyword: kw, ...r });
    } catch (err) {
      console.warn(`[pexels] error on "${kw}":`, err.message);
    }
  }
  return results;
}

/**
 * Stub: render a 10s 1080x1920 gradient clip via ffmpeg lavfi so the
 * BRollLayer has something to play during dev. No API key required.
 */
async function makeStubClip({ keyword, outDir, stubIndex = 0 }) {
  await fs.ensureDir(outDir);
  const safeName = keyword.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const dest = path.join(outDir, `broll_stub_${stubIndex}_${safeName}.mp4`);
  const [c1, c2] = STUB_GRADIENTS[stubIndex % STUB_GRADIENTS.length];
  // Vertical gradient that slowly pans — gradients + subtle hue rotation
  const filter =
    `color=c=${c1}:s=1080x1920:d=10,` +
    `geq=` +
    `r='r(X,Y)*(1-Y/H) + ${parseInt(c2.slice(2, 4), 16)}*(Y/H)':` +
    `g='g(X,Y)*(1-Y/H) + ${parseInt(c2.slice(4, 6), 16)}*(Y/H)':` +
    `b='b(X,Y)*(1-Y/H) + ${parseInt(c2.slice(6, 8), 16)}*(Y/H)',` +
    `hue=h='10*sin(2*PI*t/10)'`;
  const cmd =
    `ffmpeg -y -nostdin -f lavfi -i "${filter}" ` +
    `-t 10 -c:v libx264 -pix_fmt yuv420p -r 30 "${dest}"`;
  await execAsync(cmd);
  return {
    path: dest,
    sourceUrl: `stub:${keyword}`,
    photographer: 'dev-stub',
    _stub: true,
  };
}

module.exports = { searchAndDownload, fetchAll };
