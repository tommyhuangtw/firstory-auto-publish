/**
 * Stage 1: Fetch YouTube videos + transcripts.
 *
 * Uses YouTube Data API v3 to search for AI-related videos,
 * then fetches transcripts via Apify YouTube Transcript Scraper.
 */

import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import type { PipelineState, VideoSource } from '../state';

const log = createChildLogger('pipeline:fetch');

// Search keyword groups (rotated per run)
const SEARCH_QUERIES: Record<string, string[]> = {
  daily: [
    'new AI tools 2026',
    'best AI apps this week',
    'AI productivity tools',
    'ChatGPT Claude Gemini news',
    'AI developer tools update',
  ],
  weekly: [
    'AI tools weekly roundup',
    'best AI tools of the week',
    'AI news this week summary',
  ],
  robot: [
    'humanoid robot 2026',
    'robot AI latest news',
    'Boston Dynamics Figure Tesla Optimus',
  ],
};

// Minimum thresholds for video quality
const MIN_DURATION_SEC = 300;
const MIN_VIEWS = 5000;
const MIN_LIKES = 50;
const MIN_COMMENTS = 20;
const TOP_N = 5;

export async function fetchYoutube(state: PipelineState): Promise<Partial<PipelineState>> {
  log.info({ episodeNumber: state.episodeNumber, segmentType: state.segmentType }, 'Fetching YouTube videos');

  const db = getDb();
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    log.warn('YOUTUBE_API_KEY not set, skipping fetch');
    return { videos: [], status: 'classifying' };
  }

  const queries = SEARCH_QUERIES[state.segmentType] || SEARCH_QUERIES.daily;
  const allVideos: VideoSource[] = [];

  // Get already-used video IDs to avoid duplicates
  const usedIds = new Set(
    (db.prepare('SELECT video_id FROM youtube_sources WHERE used_in_episode IS NOT NULL').all() as { video_id: string }[])
      .map((r) => r.video_id)
  );

  for (const query of queries) {
    try {
      const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
      searchUrl.searchParams.set('part', 'snippet');
      searchUrl.searchParams.set('q', query);
      searchUrl.searchParams.set('type', 'video');
      searchUrl.searchParams.set('order', 'viewCount');
      searchUrl.searchParams.set('maxResults', '10');
      searchUrl.searchParams.set('publishedAfter', getDateDaysAgo(7));
      searchUrl.searchParams.set('key', apiKey);

      const searchResp = await fetch(searchUrl.toString());
      if (!searchResp.ok) {
        log.warn({ query, status: searchResp.status }, 'YouTube search failed');
        continue;
      }

      const searchData = await searchResp.json();
      const videoIds = (searchData.items || [])
        .map((item: { id: { videoId: string } }) => item.id.videoId)
        .filter((id: string) => !usedIds.has(id));

      if (videoIds.length === 0) continue;

      // Get video details (duration, stats)
      const detailUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
      detailUrl.searchParams.set('part', 'snippet,contentDetails,statistics');
      detailUrl.searchParams.set('id', videoIds.join(','));
      detailUrl.searchParams.set('key', apiKey);

      const detailResp = await fetch(detailUrl.toString());
      if (!detailResp.ok) continue;

      const detailData = await detailResp.json();

      for (const item of detailData.items || []) {
        const durationSec = parseDuration(item.contentDetails.duration);
        const views = parseInt(item.statistics.viewCount || '0');
        const likes = parseInt(item.statistics.likeCount || '0');
        const comments = parseInt(item.statistics.commentCount || '0');

        if (durationSec < MIN_DURATION_SEC || views < MIN_VIEWS || likes < MIN_LIKES || comments < MIN_COMMENTS) {
          continue;
        }

        allVideos.push({
          videoId: item.id,
          title: item.snippet.title,
          channelName: item.snippet.channelTitle,
          publishedAt: item.snippet.publishedAt,
          viewCount: views,
          likeCount: likes,
          commentCount: comments,
          durationSeconds: durationSec,
          transcript: '', // Will be filled by transcript fetcher
        });
      }
    } catch (error) {
      log.error({ query, error: (error as Error).message }, 'Search query failed');
    }
  }

  // Deduplicate and sort by views
  const unique = deduplicateByVideoId(allVideos);
  unique.sort((a, b) => b.viewCount - a.viewCount);
  const topVideos = unique.slice(0, TOP_N);

  // Fetch transcripts (Apify or fallback)
  for (const video of topVideos) {
    try {
      video.transcript = await fetchTranscript(video.videoId);
    } catch (error) {
      log.warn({ videoId: video.videoId, error: (error as Error).message }, 'Transcript fetch failed');
      video.transcript = '';
    }

    // Save to youtube_sources table
    db.prepare(
      `INSERT OR IGNORE INTO youtube_sources (video_id, title, channel_name, published_at, view_count, like_count, comment_count, duration_seconds, transcript)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      video.videoId, video.title, video.channelName, video.publishedAt,
      video.viewCount, video.likeCount, video.commentCount, video.durationSeconds,
      video.transcript
    );
  }

  log.info({ count: topVideos.length }, 'Videos fetched');
  return { videos: topVideos, status: 'classifying' };
}

// ── Helpers ──

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function parseDuration(iso8601: string): number {
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] || '0') * 3600) +
         (parseInt(match[2] || '0') * 60) +
         parseInt(match[3] || '0');
}

function deduplicateByVideoId(videos: VideoSource[]): VideoSource[] {
  const seen = new Set<string>();
  return videos.filter((v) => {
    if (seen.has(v.videoId)) return false;
    seen.add(v.videoId);
    return true;
  });
}

/**
 * Fetch transcript using Apify YouTube Transcript Scraper.
 * Falls back to empty string if API key not available.
 */
async function fetchTranscript(videoId: string): Promise<string> {
  const apifyToken = process.env.APIFY_API_TOKEN;
  if (!apifyToken) return '';

  const resp = await fetch(
    `https://api.apify.com/v2/acts/bernardo~youtube-transcript-scraper/run-sync-get-dataset-items?token=${apifyToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: [`https://www.youtube.com/watch?v=${videoId}`],
        outputFormat: 'text',
      }),
    }
  );

  if (!resp.ok) throw new Error(`Apify ${resp.status}`);
  const data = await resp.json();
  return data?.[0]?.text || data?.[0]?.transcript || '';
}
