/**
 * Stage 8: Publish to SoundOn + YouTube + Instagram.
 *
 * This node is triggered after human review approval.
 * SoundOn uses Playwright, YouTube uses API, IG uses Graph API.
 */

import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import type { PipelineState } from '../state';

const log = createChildLogger('pipeline:publish');

export async function publish(state: PipelineState): Promise<Partial<PipelineState>> {
  log.info({ episodeNumber: state.episodeNumber }, 'Publishing episode');

  const results: Partial<PipelineState> = { status: 'completed' };

  // SoundOn (Playwright — will be implemented in Phase 3)
  try {
    const soundonUrl = await publishToSoundOn(state);
    results.soundonUrl = soundonUrl;
    log.info({ soundonUrl }, 'SoundOn published');
  } catch (error) {
    log.error({ error: (error as Error).message }, 'SoundOn publish failed');
  }

  // YouTube (API — will be implemented in Phase 3)
  try {
    const youtubeUrl = await publishToYouTube(state);
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

/**
 * SoundOn publisher — Playwright automation.
 * Full implementation will be added in Phase 3 (Review Flow + Publisher).
 */
async function publishToSoundOn(state: PipelineState): Promise<string> {
  // Phase 3: Port src/soundon-uploader.js here with Playwright
  log.info('SoundOn publish: will be implemented in Phase 3');

  if (!state.audioPath) throw new Error('No audio file to publish');

  // Placeholder — returns empty string until Playwright integration
  return '';
}

/**
 * YouTube publisher — uses YouTube Data API.
 * Full implementation will be added in Phase 3.
 */
async function publishToYouTube(state: PipelineState): Promise<string> {
  // Phase 3: Use YouTubeService.uploadVideo() here
  log.info('YouTube publish: will be implemented in Phase 3');

  if (!state.audioPath) throw new Error('No audio file to publish');

  // Placeholder — returns empty string until YouTube integration
  return '';
}
