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
  srtPath?: string;
}

/** Escape file path for FFmpeg subtitles filter (libass) */
function escapeFFmpegSubPath(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "'\\''");
}

/**
 * Create an MP4 video from audio + static image.
 * If no cover image is provided, generates a black background video.
 */
export async function createVideoFromAudio(params: CreateVideoParams): Promise<string> {
  const { audioPath, coverPath, outputDir, srtPath } = params;

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

  const hasSubs = srtPath && fs.existsSync(srtPath);
  const fps = hasSubs ? '10' : '1';

  const args: string[] = [];

  if (coverPath && fs.existsSync(coverPath)) {
    // Build -vf filter chain
    const vfParts = ['scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black'];
    if (hasSubs) {
      const escaped = escapeFFmpegSubPath(srtPath);
      vfParts.push(`subtitles='${escaped}':force_style='FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,Outline=1,BorderStyle=4,Alignment=2,MarginV=40'`);
    }

    args.push(
      '-y', '-nostdin',
      '-loop', '1',
      '-framerate', fps,
      '-i', coverPath,
      '-i', audioPath,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      ...(hasSubs ? [] : ['-tune', 'stillimage']),
      '-crf', '23',
      ...(hasSubs ? [] : ['-g', '99999']),
      '-r', fps,
      '-c:a', 'aac',
      '-b:a', '192k',
      '-pix_fmt', 'yuv420p',
      '-vf', vfParts.join(','),
      '-shortest',
      outputPath
    );
  } else {
    // Audio + black background → video
    const vfParts: string[] = [];
    if (hasSubs) {
      const escaped = escapeFFmpegSubPath(srtPath);
      vfParts.push(`subtitles='${escaped}':force_style='FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,Outline=1,BorderStyle=4,Alignment=2,MarginV=40'`);
    }

    args.push(
      '-y', '-nostdin',
      '-f', 'lavfi',
      '-i', `color=c=black:s=1920x1080:r=${fps}`,
      '-i', audioPath,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      ...(hasSubs ? [] : ['-tune', 'stillimage']),
      '-crf', '23',
      ...(hasSubs ? [] : ['-g', '99999']),
      '-r', fps,
      '-c:a', 'aac',
      '-b:a', '192k',
      '-pix_fmt', 'yuv420p',
      ...(vfParts.length ? ['-vf', vfParts.join(',')] : []),
      '-shortest',
      outputPath
    );
  }

  log.info({ audioPath, coverPath, outputPath, srtPath: hasSubs ? srtPath : undefined, fps }, 'Creating video...');

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
