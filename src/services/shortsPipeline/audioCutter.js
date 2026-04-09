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
async function extractSegment(inputPath, startSec, endSec, outPath) {
  await fs.ensureDir(path.dirname(outPath));
  const dur = (endSec - startSec).toFixed(3);
  // Use -ss before -i for fast seek, then re-encode to AAC for stable Remotion playback
  const cmd =
    `ffmpeg -y -nostdin -ss ${startSec.toFixed(3)} -t ${dur} -i "${inputPath}" ` +
    `-c:a aac -b:a 192k -ar 44100 "${outPath}"`;
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
async function extractClips(inputPath, ranges, outDir) {
  await fs.ensureDir(outDir);
  const out = [];
  for (let i = 0; i < ranges.length; i++) {
    const dest = path.join(outDir, `clip_${i + 1}.m4a`);
    await extractSegment(inputPath, ranges[i].start, ranges[i].end, dest);
    out.push(dest);
  }
  return out;
}

/**
 * Concatenate multiple audio files into one (uses concat demuxer for speed).
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
  const listFile = outPath + '.txt';
  const listContent = audioPaths.map(p => `file '${path.resolve(p)}'`).join('\n');
  await fs.writeFile(listFile, listContent);

  // Re-encode to a single consistent AAC track to avoid concat demuxer issues
  // when sources have different codecs / sample rates.
  const cmd =
    `ffmpeg -y -nostdin -f concat -safe 0 -i "${listFile}" ` +
    `-c:a aac -b:a 192k -ar 44100 "${outPath}"`;
  await execAsync(cmd);
  await fs.remove(listFile);
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
