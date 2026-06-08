/**
 * Video Creator — generates MP4 from audio + static image for YouTube upload.
 *
 * Uses FFmpeg to combine an audio file with a cover image into a video.
 */

import { execFile, spawn } from 'child_process';
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
  // 2fps is enough for subtitle transitions (change every ~2-3s); 1fps for no subs
  const fps = hasSubs ? '2' : '1';

  const args: string[] = [];

  if (coverPath && fs.existsSync(coverPath)) {
    // Build -vf filter chain
    const vfParts = ['scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black'];
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
      '-tune', 'stillimage',
      '-crf', '28',
      '-g', '99999',
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
      '-i', `color=c=black:s=1280x720:r=${fps}`,
      '-i', audioPath,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'stillimage',
      '-crf', '28',
      '-g', '99999',
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
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderrTail = '';           // keep only last 4KB for error reporting
      const TAIL_SIZE = 4096;

      proc.stderr.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-TAIL_SIZE);
      });
      proc.stdout.resume();          // drain stdout to prevent backpressure

      const timeoutMs = hasSubs ? 1800000 : 600000; // 30 min with subs, 10 min without
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`FFmpeg timed out after ${timeoutMs / 60000} minutes`));
      }, timeoutMs);

      proc.on('error', (err) => { clearTimeout(timer); reject(err); });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}\n${stderrTail}`));
      });
    });
    log.info({ outputPath }, 'Video created');
    return outputPath;
  } catch (err) {
    const msg = (err as Error).message;
    log.error({ error: msg }, 'Video creation failed');
    throw new Error(`FFmpeg failed: ${msg}`);
  }
}
