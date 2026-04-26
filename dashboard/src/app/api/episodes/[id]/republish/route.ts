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
    const episodeNumber = parseInt(id);
    if (isNaN(episodeNumber)) {
      return NextResponse.json({ error: 'Invalid episode number' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { platform } = body as { platform?: 'soundon' | 'youtube' | 'instagram' | 'all' };
    if (!platform || !['soundon', 'youtube', 'instagram', 'all'].includes(platform)) {
      return NextResponse.json({ error: 'platform must be soundon, youtube, instagram, or all' }, { status: 400 });
    }

    const db = getDb();
    const episode = db.prepare('SELECT * FROM episodes WHERE episode_number = ?').get(episodeNumber) as Record<string, unknown> | undefined;

    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    if (episode.status !== 'published' && episode.status !== 'approved') {
      return NextResponse.json(
        { error: `只有已發布或已核准的集數才能重新發布 (目前狀態: ${episode.status})` },
        { status: 403 }
      );
    }

    // Build minimal state for publish functions
    const state: PipelineState = {
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
      memoryEnrichments: [],
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
    };

    const results: { soundonUrl?: string; youtubeUrl?: string; igPostId?: string; errors: string[] } = { errors: [] };

    // Republish to requested platform(s)
    if (platform === 'soundon' || platform === 'all') {
      try {
        const url = await publishToSoundOnPlatform(state);
        results.soundonUrl = url;
        db.prepare('UPDATE episodes SET soundon_url = ? WHERE episode_number = ?').run(url, episodeNumber);
        log.info({ episodeNumber, soundonUrl: url }, 'SoundOn republish succeeded');
      } catch (error) {
        const msg = (error as Error).message;
        results.errors.push(`SoundOn: ${msg}`);
        log.error({ episodeNumber, error: msg }, 'SoundOn republish failed');
      }
    }

    if (platform === 'youtube' || platform === 'all') {
      try {
        const url = await publishToYouTubePlatform(state);
        results.youtubeUrl = url;
        db.prepare('UPDATE episodes SET youtube_url = ? WHERE episode_number = ?').run(url, episodeNumber);
        log.info({ episodeNumber, youtubeUrl: url }, 'YouTube republish succeeded');
      } catch (error) {
        const msg = (error as Error).message;
        results.errors.push(`YouTube: ${msg}`);
        log.error({ episodeNumber, error: msg }, 'YouTube republish failed');
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
        db.prepare('UPDATE episodes SET ig_post_id = ? WHERE episode_number = ?').run(postId, episodeNumber);
        log.info({ episodeNumber, igPostId: postId }, 'Instagram republish succeeded');
      } catch (error) {
        const msg = (error as Error).message;
        results.errors.push(`Instagram: ${msg}`);
        log.error({ episodeNumber, error: msg }, 'Instagram republish failed');
      }
    }

    if (results.errors.length > 0 && !results.soundonUrl && !results.youtubeUrl && !results.igPostId) {
      return NextResponse.json({ error: results.errors.join('; ') }, { status: 500 });
    }

    return NextResponse.json({
      message: 'Republish completed',
      episodeNumber,
      soundonUrl: results.soundonUrl || null,
      youtubeUrl: results.youtubeUrl || null,
      igPostId: results.igPostId || null,
      errors: results.errors,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
