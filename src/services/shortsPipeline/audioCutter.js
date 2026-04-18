/**
 * audioCutter.js — Slice + concatenate audio segments using FFmpeg.
 *
 * Used in two places:
 *   1. extractClips() — pull 1–2 segments out of the original podcast audio
 *      (re-encoded to AAC for Remotion compatibility).
 *   2. concatAudio() — join hook(VoAI) + clips + outro(VoAI) into one master
 *      track for the Remotion composition.
 */

const path = require('path');
const fs = require('fs-extra');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * Cut a single segment out of an audio file.
 * @param {string} inputPath
 * @param {number} startSec
 * @param {number} endSec
 * @param {string} outPath
 */
async function extractSegment(inputPath, startSec, endSec, outPath, { speed = 1.0 } = {}) {
  await fs.ensureDir(path.dirname(outPath));
  const dur = (endSec - startSec).toFixed(3);
  // Use -ss before -i for fast seek, then re-encode to AAC for stable Remotion playback
  const atempoFilter = speed !== 1.0 ? `-filter:a "atempo=${speed}" ` : '';
  const cmd =
    `ffmpeg -y -nostdin -ss ${startSec.toFixed(3)} -t ${dur} -i "${inputPath}" ` +
    `${atempoFilter}-c:a aac -b:a 192k -ar 44100 "${outPath}"`;
  await execAsync(cmd);
  return outPath;
}

/**
 * Extract multiple clip ranges from a source file.
 * @param {string} inputPath
 * @param {Array<{start:number,end:number}>} ranges
 * @param {string} outDir
 * @returns {Promise<string[]>}
 */
async function extractClips(inputPath, ranges, outDir, { speed = 1.0 } = {}) {
  await fs.ensureDir(outDir);
  const out = [];
  for (let i = 0; i < ranges.length; i++) {
    const dest = path.join(outDir, `clip_${i + 1}.m4a`);
    await extractSegment(inputPath, ranges[i].start, ranges[i].end, dest, { speed });
    out.push(dest);
  }
  return out;
}

/**
 * Concatenate multiple audio files into one using the FFmpeg **concat filter**
 * (not the concat demuxer).
 *
 * Why the filter: our hook/outro come from VoAI as **mono** AAC while the clip
 * segments are extracted from the original podcast as **stereo** AAC. The
 * concat demuxer silently drops packets when channel layouts mismatch — the
 * output container has the right duration but only the first source's audio
 * actually plays. The concat filter resamples/remixes heterogeneous inputs
 * into one consistent output stream, which is exactly what we need.
 *
 * Force output to stereo (`-ac 2`) so downstream players/Remotion see a
 * uniform channel layout.
 *
 * @param {string[]} audioPaths
 * @param {string} outPath
 */
async function concatAudio(audioPaths, outPath) {
  if (!audioPaths || audioPaths.length === 0) {
    throw new Error('concatAudio: no inputs');
  }
  if (audioPaths.length === 1) {
    await fs.copy(audioPaths[0], outPath);
    return outPath;
  }

  await fs.ensureDir(path.dirname(outPath));

  const inputArgs = audioPaths.map((p) => `-i "${p}"`).join(' ');
  const filterInputs = audioPaths.map((_, i) => `[${i}:a]`).join('');
  const filterComplex = `${filterInputs}concat=n=${audioPaths.length}:v=0:a=1[out]`;

  const cmd =
    `ffmpeg -y -nostdin ${inputArgs} ` +
    `-filter_complex "${filterComplex}" -map "[out]" ` +
    `-c:a aac -b:a 192k -ar 44100 -ac 2 "${outPath}"`;
  await execAsync(cmd);
  return outPath;
}

/**
 * Get duration of an audio file in seconds (uses ffprobe).
 */
async function getDuration(audioPath) {
  const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`;
  const { stdout } = await execAsync(cmd);
  return parseFloat(stdout.trim());
}

module.exports = { extractSegment, extractClips, concatAudio, getDuration };
