/**
 * Stage 8: Publish to SoundOn + YouTube + Instagram.
 *
 * This node is triggered after human review approval.
 * Episode number is already assigned by publishEpisode() in graph.ts before this runs.
 * SoundOn uses Playwright, YouTube uses API (via video creator + upload).
 * Instagram uses Facebook Graph API via Cloudinary upload.
 * Each platform is independent — one failure doesn't block the other.
 */

import path from 'path';
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
      await gmail.initialize();
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
  // Source links are already appended by generateMeta (deterministic, not LLM)
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

  // Step 1: ALWAYS generate composite image (left panel title + right panel cover) for video frame
  const { generateYouTubeThumbnail } = await import('@/services/thumbnailGenerator');
  const compositeImagePath = await generateYouTubeThumbnail({
    title: state.selectedTitle,
    episodeNumber: state.episodeNumber,
    coverImagePath: state.coverPath,
    segmentType: state.segmentType,
  });
  log.info({ compositeImagePath }, 'Generated composite image for video frame');

  // Step 2: Determine YouTube thumbnail for metadata (user-selected or composite)
  let ytThumbnailPath: string;
  const { getDb } = await import('@/db');
  const { default: fs } = await import('fs-extra');
  const epRow = getDb().prepare('SELECT yt_thumbnail_path FROM episodes WHERE id = ?').get(state.episodeId) as { yt_thumbnail_path: string | null } | undefined;
  if (epRow?.yt_thumbnail_path && fs.existsSync(epRow.yt_thumbnail_path)) {
    ytThumbnailPath = epRow.yt_thumbnail_path;
    log.info({ ytThumbnailPath }, 'Using user-selected YouTube thumbnail for metadata');
  } else {
    ytThumbnailPath = compositeImagePath;
    log.info('Using composite as YouTube thumbnail (no user selection)');
  }

  // Step 3: Create video from audio + composite image + burned-in subtitles
  // If no SRT data at all (pipeline stage was skipped), generate on-the-fly
  if (!state.srtContent && state.audioPath && state.scriptZh) {
    log.warn({ episodeId: state.episodeId }, 'No SRT data — generating subtitles on-the-fly before publish');
    const { generateSubtitles } = await import('@/services/subtitleGenerator');
    const result = await generateSubtitles(state.audioPath, state.scriptZh);
    state.srtContent = result.srtContent;
    state.srtPath = state.audioPath.replace(/\.mp3$/, '.srt');
    const srtDir = path.dirname(state.srtPath);
    if (!fs.existsSync(srtDir)) fs.mkdirSync(srtDir, { recursive: true });
    fs.writeFileSync(state.srtPath, state.srtContent, 'utf-8');
    // Persist to DB
    const db2 = getDb();
    db2.prepare('UPDATE episodes SET srt_path = ?, srt_content = ? WHERE id = ?')
      .run(state.srtPath, state.srtContent, state.episodeId);
    // Log Whisper cost
    const durationMin = result.transcription.duration / 60;
    const costUsd = durationMin * 0.006;
    try {
      db2.prepare(
        'INSERT INTO service_costs (episode_id, episode_number, service, model, units, cost_usd, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(state.episodeId, state.episodeNumber ?? null, 'openai_whisper', 'whisper-1', Math.ceil(durationMin), costUsd, 0);
    } catch (err) {
      log.warn({ error: (err as Error).message }, 'Failed to log Whisper cost');
    }
    log.info({ episodeId: state.episodeId, cues: result.cues.length, costUsd: costUsd.toFixed(4) }, 'On-the-fly subtitle generation complete');
  }

  // Ensure SRT file exists for subtitle burning (temp file may have been deleted)
  let srtPath: string | undefined = state.srtPath || undefined;
  if (srtPath && !fs.existsSync(srtPath)) {
    if (state.srtContent) {
      // Recreate SRT file from DB-stored content
      const srtDir = path.dirname(srtPath);
      if (!fs.existsSync(srtDir)) fs.mkdirSync(srtDir, { recursive: true });
      fs.writeFileSync(srtPath, state.srtContent, 'utf-8');
      log.info({ srtPath }, 'Recreated SRT file from stored content');
    } else {
      log.warn({ srtPath }, 'SRT file missing and no srt_content available — video will have no subtitles');
      srtPath = undefined;
    }
  }

  const { createVideoFromAudio } = await import('@/services/videoCreator');
  const videoPath = await createVideoFromAudio({
    audioPath: state.audioPath,
    coverPath: compositeImagePath,
    srtPath,
  });

  // Step 4: Assemble final YouTube description (ad + main + footer + hashtags)
  // Source links are already appended by generateMeta (deterministic, not LLM)
  const ytDesc = state.youtubeDescription || state.description;
  const { assembleYoutubeDescription } = await import('@/services/descriptionAssembler');
  const finalDescription = assembleYoutubeDescription(ytDesc, state.tags);

  // Step 5: Upload to YouTube with user-selected thumbnail (or composite) for metadata
  const { YouTubeService } = await import('@/services/youtube');
  const yt = new YouTubeService();
  await yt.initialize();
  const result = await yt.uploadVideo({
    videoPath,
    title: formattedTitle,
    description: finalDescription,
    tags: state.tags,
    privacyStatus: 'public',
    thumbnailPath: ytThumbnailPath,
  });

  // Upload subtitles if available
  if (state.srtContent) {
    try {
      await yt.uploadCaption({
        videoId: result.videoId,
        srtContent: state.srtContent,
      });
      log.info({ videoId: result.videoId }, 'Subtitles uploaded to YouTube');
    } catch (err) {
      log.error({ videoId: result.videoId, error: (err as Error).message }, 'YouTube caption upload failed (video uploaded OK, but no closed captions)');
    }
  }

  return result.videoUrl;
}
