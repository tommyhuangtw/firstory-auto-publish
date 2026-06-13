import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { publishToSoundOnPlatform, publishToYouTubePlatform } from '@/services/pipeline/nodes/publish';
import type { PipelineState, SegmentType } from '@/services/pipeline/state';

const log = createChildLogger('api:republish');

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const episodeId = parseInt(id);
    if (isNaN(episodeId)) {
      return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { platform } = body as { platform?: 'soundon' | 'youtube' | 'instagram' | 'facebook' | 'threads' | 'all' };
    if (!platform || !['soundon', 'youtube', 'instagram', 'facebook', 'threads', 'all'].includes(platform)) {
      return NextResponse.json({ error: 'platform must be soundon, youtube, instagram, facebook, threads, or all' }, { status: 400 });
    }

    const db = getDb();
    const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId) as Record<string, unknown> | undefined;

    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    if (episode.status !== 'published' && episode.status !== 'approved' && episode.status !== 'publishing') {
      return NextResponse.json(
        { error: `只有已發布或已核准的集數才能重新發布 (目前狀態: ${episode.status})` },
        { status: 403 }
      );
    }

    const episodeNumber = episode.episode_number as number | null;
    if (!episodeNumber) {
      return NextResponse.json(
        { error: '集數尚未分配 episode number，無法重新發布' },
        { status: 400 }
      );
    }

    // Build minimal state for publish functions
    const state: PipelineState = {
      episodeId,
      episodeNumber,
      segmentType: (episode.segment_type as SegmentType) || 'daily',
      pipelineRunId: 0,
      videos: [],
      classifiedVideos: [],
      selectedVideos: [],
      excludedVideoIds: [],
      scriptEn: (episode.script_en as string) || '',
      scriptWordCount: (episode.script_word_count as number) || 0,
      extractedTools: [],
      scriptZh: (episode.script_zh as string) || '',
      customContentInserted: false,
      memoryContext: null,
      qualityScore: null,
      qualityIterations: 0,
      qualityHistory: [],
      scriptSummary: '',
      candidateTitles: [],
      selectedTitle: (episode.selected_title as string) || '',
      description: (episode.description as string) || '',
      youtubeDescription: (episode.youtube_description as string) || '',
      tags: JSON.parse((episode.tags as string) || '[]'),
      coverPath: (episode.cover_path as string) || '',
      coverUrl: '',
      audioPath: (episode.audio_path as string) || '',
      audioDurationSec: 0,
      driveAudioUrl: '',
      driveImageUrl: '',
      igScenario: '',
      igCaption: (episode.ig_caption as string) || '',
      emailHtml: '',
      igPostId: '',
      status: 'publishing',
      approvedAt: '',
      soundonUrl: (episode.soundon_url as string) || '',
      youtubeUrl: (episode.youtube_url as string) || '',
      totalCostUsd: (episode.total_cost_usd as number) || 0,
      error: '',
      coverError: '',
      publishErrors: [],
      manualVideoUrls: [],
      customInstructions: '',
      episodeLength: null,
      sourceLinks: JSON.parse((episode.source_links as string) || '[]'),
      srtPath: (episode.srt_path as string) || '',
      srtContent: (episode.srt_content as string) || '',
    };

    const results: { soundonUrl?: string; youtubeUrl?: string; igPostId?: string; fbPostId?: string; fbPostUrl?: string; threadsPostId?: string; errors: string[] } = { errors: [] };

    // Republish to requested platform(s)
    if (platform === 'soundon' || platform === 'all') {
      try {
        const url = await publishToSoundOnPlatform(state);
        results.soundonUrl = url;
        db.prepare('UPDATE episodes SET soundon_url = ? WHERE id = ?').run(url, episodeId);
        log.info({ episodeId, soundonUrl: url }, 'SoundOn republish succeeded');
      } catch (error) {
        const msg = (error as Error).message;
        results.errors.push(`SoundOn: ${msg}`);
        log.error({ episodeId, error: msg }, 'SoundOn republish failed');
      }
    }

    if (platform === 'youtube' || platform === 'all') {
      try {
        const url = await publishToYouTubePlatform(state);
        results.youtubeUrl = url;
        db.prepare('UPDATE episodes SET youtube_url = ? WHERE id = ?').run(url, episodeId);
        log.info({ episodeId, youtubeUrl: url }, 'YouTube republish succeeded');
      } catch (error) {
        const msg = (error as Error).message;
        results.errors.push(`YouTube: ${msg}`);
        log.error({ episodeId, error: msg }, 'YouTube republish failed');
      }
    }

    if (platform === 'instagram' || platform === 'all') {
      try {
        const caption = (episode.ig_caption as string) || '';
        if (!caption) throw new Error('沒有 IG 貼文內容，請先生成 IG 貼文');

        const coverPath = (episode.cover_path as string) || '';
        if (!coverPath) throw new Error('沒有封面圖片');

        // Upload cover to Cloudinary to get public URL
        const { uploadToCloudinary } = await import('@/services/cloudinary');
        const publicUrl = await uploadToCloudinary(coverPath, `ep${episodeNumber}_ig_republish.png`);

        const { postToInstagram } = await import('@/services/instagram');
        const postId = await postToInstagram(publicUrl, caption);
        results.igPostId = postId;
        db.prepare('UPDATE episodes SET ig_post_id = ? WHERE id = ?').run(postId, episodeId);
        log.info({ episodeId, igPostId: postId }, 'Instagram republish succeeded');
      } catch (error) {
        const msg = (error as Error).message;
        results.errors.push(`Instagram: ${msg}`);
        log.error({ episodeId, error: msg }, 'Instagram republish failed');
      }
    }

    if (platform === 'facebook' || platform === 'instagram' || platform === 'all') {
      try {
        const caption = (episode.ig_caption as string) || '';
        if (!caption) throw new Error('沒有 IG 貼文內容，無法產生 FB 貼文');

        const coverPath = (episode.cover_path as string) || '';
        if (!coverPath) throw new Error('沒有封面圖片');

        // Reuse publicUrl if already uploaded for IG, otherwise upload
        let fbImageUrl: string;
        if (results.igPostId && platform !== 'facebook') {
          // IG block already uploaded, we need to upload again for FB
          const { uploadToCloudinary } = await import('@/services/cloudinary');
          fbImageUrl = await uploadToCloudinary(coverPath, `ep${episodeNumber}_fb.png`);
        } else {
          const { uploadToCloudinary } = await import('@/services/cloudinary');
          fbImageUrl = await uploadToCloudinary(coverPath, `ep${episodeNumber}_fb.png`);
        }

        const { postPhotoToFacebook, buildFacebookCaption } = await import('@/services/facebook');
        // Use saved fb_caption if available, otherwise generate
        let fbCaption = (episode.fb_caption as string) || '';
        if (!fbCaption) {
          fbCaption = await buildFacebookCaption({
            igCaption: caption,
            sourceLinks: JSON.parse((episode.source_links as string) || '[]'),
            episodeTitle: (episode.selected_title as string) || '',
            episodeNumber,
            segmentType: (episode.segment_type as string) || 'daily',
          });
          db.prepare('UPDATE episodes SET fb_caption = ? WHERE id = ?').run(fbCaption, episodeId);
        }
        const { getFacebookPostUrl } = await import('@/services/facebook');
        const fbPostId = await postPhotoToFacebook(fbImageUrl, fbCaption);
        if (fbPostId) {
          results.fbPostId = fbPostId;
          results.fbPostUrl = getFacebookPostUrl(fbPostId);
          db.prepare('UPDATE episodes SET fb_post_id = ? WHERE id = ?').run(fbPostId, episodeId);
          log.info({ episodeId, fbPostId, fbPostUrl: results.fbPostUrl }, 'Facebook post succeeded');
        }
      } catch (error) {
        const msg = (error as Error).message;
        results.errors.push(`Facebook: ${msg}`);
        log.warn({ episodeId, error: msg }, 'Facebook post failed (non-blocking)');
      }
    }

    if (platform === 'threads' || platform === 'all') {
      try {
        const igCaption = (episode.ig_caption as string) || '';
        if (!igCaption) throw new Error('沒有 IG 貼文內容，無法產生 Threads 貼文');

        const { postImageToThreads, postTextToThreads, buildThreadsCaption } = await import('@/services/threads');

        // Use saved threads_caption if available, otherwise generate
        let threadsCaption = (episode.threads_caption as string) || '';
        if (!threadsCaption) {
          threadsCaption = await buildThreadsCaption({
            igCaption,
            episodeTitle: (episode.selected_title as string) || '',
            episodeNumber,
            segmentType: (episode.segment_type as string) || 'daily',
          });
          db.prepare('UPDATE episodes SET threads_caption = ? WHERE id = ?').run(threadsCaption, episodeId);
        }

        let threadsPostId: string | null = null;
        const coverPath = (episode.cover_path as string) || '';
        if (coverPath) {
          // Upload cover to get public URL for Threads
          const { uploadToCloudinary } = await import('@/services/cloudinary');
          const publicUrl = await uploadToCloudinary(coverPath, `ep${episodeNumber}_threads.png`);
          threadsPostId = await postImageToThreads(publicUrl, threadsCaption);
        } else {
          threadsPostId = await postTextToThreads(threadsCaption);
        }

        if (threadsPostId) {
          results.threadsPostId = threadsPostId;
          db.prepare('UPDATE episodes SET threads_post_id = ? WHERE id = ?').run(threadsPostId, episodeId);
          log.info({ episodeId, threadsPostId }, 'Threads post succeeded');
        }
      } catch (error) {
        const msg = (error as Error).message;
        results.errors.push(`Threads: ${msg}`);
        log.warn({ episodeId, error: msg }, 'Threads post failed (non-blocking)');
      }
    }

    if (results.errors.length > 0 && !results.soundonUrl && !results.youtubeUrl && !results.igPostId && !results.fbPostId && !results.threadsPostId) {
      return NextResponse.json({ error: results.errors.join('; ') }, { status: 500 });
    }

    return NextResponse.json({
      message: 'Republish completed',
      episodeId,
      soundonUrl: results.soundonUrl || null,
      youtubeUrl: results.youtubeUrl || null,
      igPostId: results.igPostId || null,
      fbPostId: results.fbPostId || null,
      fbPostUrl: results.fbPostUrl || null,
      threadsPostId: results.threadsPostId || null,
      errors: results.errors,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
