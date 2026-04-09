/**
 * pexels.js — Search & download royalty-free B-roll videos from Pexels.
 *
 * Docs: https://www.pexels.com/api/documentation/#videos
 *
 * Until PEXELS_API_KEY is set, returns an empty list (Remotion composition
 * will fall back to a solid-color / blurred-cover background).
 */

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');

const PEXELS_API = 'https://api.pexels.com/videos/search';

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
async function searchAndDownload({ keyword, outDir, minDurationSec = 8, orientation = 'portrait' }) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.warn(`⚠️  [pexels] PEXELS_API_KEY not set — skipping "${keyword}"`);
    return null;
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
  for (const kw of keywords) {
    try {
      const r = await searchAndDownload({ keyword: kw, outDir });
      if (r) results.push({ keyword: kw, ...r });
    } catch (err) {
      console.warn(`[pexels] error on "${kw}":`, err.message);
    }
  }
  return results;
}

module.exports = { searchAndDownload, fetchAll };
