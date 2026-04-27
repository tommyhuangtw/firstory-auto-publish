/**
 * Stage 1: Fetch YouTube videos (search only, snippet data).
 *
 * Matches n8n flow:
 *   25 keywords × 4 maxResults = up to 100 results
 *   → dedup by videoId
 *   → pass to classify stage (no stats, no transcripts yet)
 *
 * Stats, filtering, and transcript fetching happen in classify stage.
 */

import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { withRetry } from '@/lib/retry';
import type { PipelineState, VideoSource } from '../state';

const log = createChildLogger('pipeline:fetch');

// Search keyword groups (matches n8n exactly)
const SEARCH_QUERIES: Record<string, string[]> = {
  daily: [
    'Top AI tools',
    'AI automation',
    'AI workflow tools',
    'VIbe Coding',
    'AI Assistant',
    'Agentic AI',
    'Claude',
    'ChatGPT',
    'GPT',
    'Grok',
    'Best Model ever',
    'AI coding tools',
    'AI for marketing',
    'n8n AI integration',
    'Google AI',
    'Voice AI apps',
    'AI agents 2025',
    'Make money with AI',
    'AI business ideas',
    'AI productivity tools',
    'AI tools for devs',
    'Joma Tech AI',
    'Sentdex GPT',
    'Jordan Harrod AI',
    'Valentin Charrier AI',
  ],
  weekly: [
    'AI tools weekly roundup',
    'best AI tools of the week',
    'AI news this week summary',
  ],
  robot: [
    'robotics',
    'robotics technology update',
    'robotics breakthrough',
    'robotics news',
    'quadruped robot',
    'humanoid robot',
    'robotics research',
    'self driving',
    'Autonomous Vehicle',
    'nvidia robot',
    'unitree',
    'optimus',
    'Figure AI',
    'Google Robotics',
  ],
};

export async function fetchYoutube(state: PipelineState): Promise<Partial<PipelineState>> {
  log.info({ episodeId: state.episodeId, segmentType: state.segmentType }, 'Fetching YouTube videos');

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    log.warn('YOUTUBE_API_KEY not set, skipping fetch');
    return { videos: [], status: 'classifying' };
  }

  // Weekly uses same keywords as daily but wider time window
  const queries = state.segmentType === 'weekly'
    ? SEARCH_QUERIES.daily
    : (SEARCH_QUERIES[state.segmentType] || SEARCH_QUERIES.daily);
  const searchDays = state.segmentType === 'robot' ? 8.5
    : state.segmentType === 'weekly' ? 10
    : 2.5;
  const allVideos: VideoSource[] = [];

  // Step 1: Search with snippet only (no stats fetch yet — matches n8n)
  for (const query of queries) {
    try {
      const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
      searchUrl.searchParams.set('part', 'snippet');
      searchUrl.searchParams.set('q', query);
      searchUrl.searchParams.set('type', 'video');
      searchUrl.searchParams.set('order', 'viewCount');
      searchUrl.searchParams.set('maxResults', '4');
      searchUrl.searchParams.set('regionCode', 'US');
      searchUrl.searchParams.set('publishedAfter', getDateDaysAgo(searchDays));
      searchUrl.searchParams.set('key', apiKey);

      const searchResp = await withRetry(
        async () => {
          const r = await fetch(searchUrl.toString());
          if (!r.ok) {
            const errBody = await r.text().catch(() => '');
            throw new Error(`YouTube search ${r.status}: ${errBody.slice(0, 200)}`);
          }
          return r;
        },
        { label: `youtube-search:${query}` },
      );

      const searchData = await searchResp.json();
      for (const item of searchData.items || []) {
        allVideos.push({
          videoId: item.id.videoId,
          title: item.snippet.title,
          channelName: item.snippet.channelTitle,
          publishedAt: item.snippet.publishedAt,
          // No stats yet — will be fetched in classify after LLM filtering
          viewCount: 0,
          likeCount: 0,
          commentCount: 0,
          durationSeconds: 0,
          transcript: '',
        });
      }

      log.info({ query, found: (searchData.items || []).length }, 'Search results');
    } catch (error) {
      log.error({ query, error: (error as Error).message }, 'Search query failed');
    }
  }

  // Step 2: Dedup by videoId
  const unique = deduplicateByVideoId(allVideos);
  log.info({ total: allVideos.length, unique: unique.length }, 'Videos fetched and deduped');

  return { videos: unique, status: 'classifying' };
}

// ── Helpers ──

function getDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function deduplicateByVideoId(videos: VideoSource[]): VideoSource[] {
  const seen = new Set<string>();
  return videos.filter((v) => {
    if (seen.has(v.videoId)) return false;
    seen.add(v.videoId);
    return true;
  });
}
