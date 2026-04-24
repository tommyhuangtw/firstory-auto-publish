/**
 * Stage 8: Publish to SoundOn + YouTube.
 *
 * This node is triggered after human review approval.
 * SoundOn uses Playwright, YouTube uses API (via video creator + upload).
 * Each platform is independent — one failure doesn't block the other.
 */

import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import type { PipelineState } from '../state';

const log = createChildLogger('pipeline:publish');

export async function publish(state: PipelineState): Promise<Partial<PipelineState>> {
  log.info({ episodeNumber: state.episodeNumber }, 'Publishing episode');

  const results: Partial<PipelineState> = { status: 'completed' };

  // SoundOn (Playwright)
  try {
    const soundonUrl = await publishToSoundOnPlatform(state);
    results.soundonUrl = soundonUrl;
    log.info({ soundonUrl }, 'SoundOn published');
  } catch (error) {
    log.error({ error: (error as Error).message }, 'SoundOn publish failed');
  }

  // YouTube (video creator + API upload)
  try {
    const youtubeUrl = await publishToYouTubePlatform(state);
    results.youtubeUrl = youtubeUrl;
    log.info({ youtubeUrl }, 'YouTube published');
  } catch (error) {
    log.error({ error: (error as Error).message }, 'YouTube publish failed');
  }

  // Update episode in DB
  const db = getDb();
  db.prepare(
    `UPDATE episodes SET
      status = 'published',
      soundon_url = ?,
      youtube_url = ?,
      published_at = datetime('now')
    WHERE episode_number = ?`
  ).run(results.soundonUrl || null, results.youtubeUrl || null, state.episodeNumber);

  return results;
}

async function publishToSoundOnPlatform(state: PipelineState): Promise<string> {
  if (!state.audioPath) throw new Error('No audio file to publish');

  // Lazy import to avoid crash if playwright not installed
  const { publishToSoundOn } = await import('@/services/soundon');
  return publishToSoundOn({
    title: state.selectedTitle,
    description: state.description,
    audioPath: state.audioPath,
  });
}

async function publishToYouTubePlatform(state: PipelineState): Promise<string> {
  if (!state.audioPath) throw new Error('No audio file to publish');

  // Step 1: Create video from audio + cover
  const { createVideoFromAudio } = await import('@/services/videoCreator');
  const videoPath = await createVideoFromAudio({
    audioPath: state.audioPath,
  });

  // Step 2: Upload to YouTube
  const { YouTubeService } = await import('@/services/youtube');
  const yt = new YouTubeService();
  await yt.initialize();
  const result = await yt.uploadVideo({
    videoPath,
    title: state.selectedTitle,
    description: state.description,
    tags: state.tags,
    privacyStatus: 'public',
  });

  return result.videoUrl;
}
