/**
 * Stage 8: Publish to SoundOn + YouTube + Instagram.
 *
 * This node is triggered after human review approval.
 * Episode number is already assigned by publishEpisode() in graph.ts before this runs.
 * SoundOn uses Playwright, YouTube uses API (via video creator + upload).
 * Instagram uses Facebook Graph API via Cloudinary upload.
 * Each platform is independent — one failure doesn't block the other.
 */

import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import type { PipelineState } from '../state';

const log = createChildLogger('pipeline:publish');

// ── Title Formatting ──

export function formatSoundonTitle(episodeNumber: number, segmentType: string, title: string): string {
  if (segmentType === 'weekly') return `EP${episodeNumber} ｜ AI懶人精選週報 – ${title}`;
  if (segmentType === 'robot') return `EP${episodeNumber} ｜ 機器人觀察週報 – ${title}`;
  if (segmentType === 'sysdesign') return `EP${episodeNumber} ｜ 系統設計懶懶學 – ${title}`;
  return `EP${episodeNumber} – ${title}`;
}

export function formatYoutubeTitle(episodeNumber: number, segmentType: string, title: string): string {
  if (segmentType === 'weekly') return `AI懶人報Podcast ｜ EP${episodeNumber} AI懶人精選週報 - ${title}`;
  if (segmentType === 'robot') return `AI懶人報Podcast ｜ EP${episodeNumber} 機器人觀察週報 - ${title}`;
  if (segmentType === 'sysdesign') return `AI懶人報Podcast ｜ EP${episodeNumber} 系統設計懶懶學 - ${title}`;
  return `AI懶人報Podcast ｜ EP${episodeNumber} - ${title}`;
}

export async function publish(state: PipelineState): Promise<Partial<PipelineState>> {
  const episodeNumber = state.episodeNumber;
  if (!episodeNumber) throw new Error('Episode number must be assigned before publishing');

  log.info({ episodeId: state.episodeId, episodeNumber }, 'Publishing episode');

  const results: Partial<PipelineState> = { status: 'completed' };
  const publishErrors: Array<{ platform: string; error: string }> = [];

  // SoundOn (Playwright)
  try {
    const soundonUrl = await publishToSoundOnPlatform(state);
    results.soundonUrl = soundonUrl;
    log.info({ soundonUrl }, 'SoundOn published');
  } catch (error) {
    const msg = (error as Error).message;
    log.error({ error: msg }, 'SoundOn publish failed');
    publishErrors.push({ platform: 'SoundOn', error: msg });
  }

  // YouTube (video creator + API upload)
  try {
    const youtubeUrl = await publishToYouTubePlatform(state);
    results.youtubeUrl = youtubeUrl;
    log.info({ youtubeUrl }, 'YouTube published');
  } catch (error) {
    const msg = (error as Error).message;
    log.error({ error: msg }, 'YouTube publish failed');
    publishErrors.push({ platform: 'YouTube', error: msg });
  }

  // Instagram (cover image + caption)
  try {
    if (state.coverUrl && state.igCaption && process.env.INSTAGRAM_ACCESS_TOKEN) {
      const { postToInstagram } = await import('@/services/instagram');
      const postId = await postToInstagram(state.coverUrl, state.igCaption);
      results.igPostId = postId;
      log.info({ postId }, 'Instagram posted');
    } else {
      log.info('Skipping Instagram (no cover URL, caption, or token)');
    }
  } catch (error) {
    const msg = (error as Error).message;
    log.error({ error: msg }, 'Instagram post failed');
    publishErrors.push({ platform: 'Instagram', error: msg });
  }

  // Send email notification if any platform failed
  if (publishErrors.length > 0) {
    try {
      const { getGmailService } = await import('@/services/gmail');
      const gmail = getGmailService();
      await gmail.sendPublishFailureNotification({
        episodeNumber,
        segmentType: state.segmentType,
        title: state.selectedTitle,
        publishErrors,
        soundonUrl: results.soundonUrl,
        youtubeUrl: results.youtubeUrl,
        igPostId: results.igPostId,
      });
    } catch (emailErr) {
      log.error({ error: (emailErr as Error).message }, 'Failed to send publish failure email');
    }
  }

  // Update episode in DB
  const db = getDb();
  db.prepare(
    `UPDATE episodes SET
      status = 'published',
      soundon_url = ?,
      youtube_url = ?,
      ig_post_id = ?,
      published_at = datetime('now')
    WHERE id = ?`
  ).run(
    results.soundonUrl || null,
    results.youtubeUrl || null,
    results.igPostId || null,
    state.episodeId
  );

  results.publishErrors = publishErrors;
  return results;
}

export async function publishToSoundOnPlatform(state: PipelineState): Promise<string> {
  if (!state.audioPath) throw new Error('No audio file to publish');
  if (!state.episodeNumber) throw new Error('Episode number not assigned');

  const formattedTitle = formatSoundonTitle(state.episodeNumber, state.segmentType, state.selectedTitle);
  log.info({ formattedTitle }, 'Publishing to SoundOn');

  // Assemble final description with ad content + footer (buymeacoffee)
  // Source links are already included by generateMeta via LLM prompt
  const { assemblePodcastDescription } = await import('@/services/descriptionAssembler');
  const finalDescription = assemblePodcastDescription(state.description);

  // Lazy import to avoid crash if playwright not installed
  const { publishToSoundOn } = await import('@/services/soundon');
  return publishToSoundOn({
    title: formattedTitle,
    description: finalDescription,
    audioPath: state.audioPath,
    coverPath: state.coverPath,
  });
}

export async function publishToYouTubePlatform(state: PipelineState): Promise<string> {
  if (!state.audioPath) throw new Error('No audio file to publish');
  if (!state.episodeNumber) throw new Error('Episode number not assigned');

  const formattedTitle = formatYoutubeTitle(state.episodeNumber, state.segmentType, state.selectedTitle);
  log.info({ formattedTitle }, 'Publishing to YouTube');

  // Step 1: Generate composite YouTube thumbnail (brand + title | cover image)
  const { generateYouTubeThumbnail } = await import('@/services/thumbnailGenerator');
  const thumbnailPath = await generateYouTubeThumbnail({
    title: state.selectedTitle,
    episodeNumber: state.episodeNumber,
    coverImagePath: state.coverPath,
    segmentType: state.segmentType,
  });

  // Step 2: Create video from audio + composite thumbnail (title + IG cover)
  const { createVideoFromAudio } = await import('@/services/videoCreator');
  const videoPath = await createVideoFromAudio({
    audioPath: state.audioPath,
    coverPath: thumbnailPath,
  });

  // Step 3: Assemble final YouTube description (ad + main + footer + hashtags)
  // Source links are already included by generateMeta via LLM prompt
  const ytDesc = state.youtubeDescription || state.description;
  const { assembleYoutubeDescription } = await import('@/services/descriptionAssembler');
  const finalDescription = assembleYoutubeDescription(ytDesc, state.tags);

  // Step 4: Upload to YouTube with composite thumbnail
  const { YouTubeService } = await import('@/services/youtube');
  const yt = new YouTubeService();
  await yt.initialize();
  const result = await yt.uploadVideo({
    videoPath,
    title: formattedTitle,
    description: finalDescription,
    tags: state.tags,
    privacyStatus: 'public',
    thumbnailPath,
  });

  return result.videoUrl;
}
