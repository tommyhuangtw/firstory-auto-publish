/**
 * Video Creator — generates MP4 from audio + static image for YouTube upload.
 *
 * Uses FFmpeg to combine an audio file with a cover image into a video.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { createChildLogger } from '@/lib/logger';

const execFileAsync = promisify(execFile);
const log = createChildLogger('videoCreator');

interface CreateVideoParams {
  audioPath: string;
  coverPath?: string;
  outputDir?: string;
}

/**
 * Create an MP4 video from audio + static image.
 * If no cover image is provided, generates a black background video.
 */
export async function createVideoFromAudio(params: CreateVideoParams): Promise<string> {
  const { audioPath, coverPath, outputDir } = params;

  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const outDir = outputDir || path.dirname(audioPath);
  const baseName = path.basename(audioPath, path.extname(audioPath));
  const outputPath = path.join(outDir, `${baseName}.mp4`);

  // Check if ffmpeg is available
  try {
    await execFileAsync('ffmpeg', ['-version']);
  } catch {
    throw new Error('ffmpeg is not installed or not in PATH');
  }

  const args: string[] = [];

  if (coverPath && fs.existsSync(coverPath)) {
    // Audio + cover image → video
    args.push(
      '-loop', '1',
      '-i', coverPath,
      '-i', audioPath,
      '-c:v', 'libx264',
      '-tune', 'stillimage',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-pix_fmt', 'yuv420p',
      '-shortest',
      '-y',
      outputPath
    );
  } else {
    // Audio + black background → video
    args.push(
      '-f', 'lavfi',
      '-i', 'color=c=black:s=1920x1080:r=1',
      '-i', audioPath,
      '-c:v', 'libx264',
      '-tune', 'stillimage',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-pix_fmt', 'yuv420p',
      '-shortest',
      '-y',
      outputPath
    );
  }

  log.info({ audioPath, coverPath, outputPath }, 'Creating video...');

  try {
    await execFileAsync('ffmpeg', args, { timeout: 600000 }); // 10min max
    log.info({ outputPath }, 'Video created');
    return outputPath;
  } catch (err) {
    const msg = (err as Error).message;
    log.error({ error: msg }, 'Video creation failed');
    throw new Error(`FFmpeg failed: ${msg}`);
  }
}
