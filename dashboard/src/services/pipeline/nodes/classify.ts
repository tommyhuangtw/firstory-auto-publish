/**
 * Stage 2: Classify → Fetch Stats → Filter → Top 5 → Fetch Transcripts.
 *
 * Matches n8n flow exactly:
 *   1. LLM classify each video (title+desc only, no transcript needed)
 *   2. Keep only is_tool / is_robotics
 *   3. Fetch full stats (views, likes, duration) via YouTube Videos API
 *   4. Check against history (already-used videos)
 *   5. Metadata filter: duration≥300s, views>5000, likes>50, comments>20
 *   6. Sort by viewCount, take top 5
 *   7. Fetch transcripts for ONLY these 5 videos
 */

import { getDb } from '@/db';
import { getLLMService } from '@/services/llmService';
import { createChildLogger } from '@/lib/logger';
import { withRetry } from '@/lib/retry';
import { fetchWithKeyRotation } from '@/lib/youtubeKeys';
import type { PipelineState, SourceLink, VideoSource } from '../state';

const log = createChildLogger('pipeline:classify');

const CLASSIFICATION_MODEL = 'google/gemini-3.1-flash-lite-preview';

const MIN_DURATION_SEC = 300;
const MAX_DURATION_SEC_WEEKLY = 2400; // Weekly: max 40 min (n8n)
const MIN_VIEWS = 5000;
const MIN_LIKES = 50;
const MIN_COMMENTS = 20;
const TOP_N = 5;
const TRANSCRIPT_DELAY_MS = 8000; // Rate limit between Apify calls (matches n8n 等待8秒)

export async function classify(state: PipelineState): Promise<Partial<PipelineState>> {
  log.info({ count: state.videos.length, segmentType: state.segmentType }, 'Starting classify pipeline');

  if (state.videos.length === 0) {
    return { classifiedVideos: [], selectedVideos: [], status: 'scripting' };
  }

  const db = getDb();
  const llm = getLLMService();
  const isRobot = state.segmentType === 'robot';
  const isSysdesign = state.segmentType === 'sysdesign';

  // ── sysdesign: skip classification, fetch stats+transcripts for all ──
  if (isSysdesign) {
    return classifySysdesign(state, db);
  }

  // ── Step 1: LLM Classification (title+desc only, parallel) ──
  log.info({ count: state.videos.length }, 'Step 1: LLM classification');

  const classified: VideoSource[] = [];
  const results = await Promise.allSettled(
    state.videos.map(async (video) => {
      const prompt = buildClassificationPrompt(video, isRobot);
      const result = await llm.call({
        stage: 'classify',
        episodeId: state.episodeId,
        messages: [{ role: 'user', content: prompt }],
        options: {
          preferredModel: CLASSIFICATION_MODEL,
          maxTokens: 256,
          temperature: 0.1,
        },
      });

      if (result.success && result.content) {
        const content = result.content.trim().toLowerCase();
        const isRelevant = content.includes('true') || content.includes('"is_tool"') || content.includes('"is_robotics"');
        video.classification = isRobot
          ? (isRelevant ? 'is_robotics' : 'non_robotics')
          : (isRelevant ? 'is_tool' : 'not_tool');
      } else {
        video.classification = isRobot ? 'non_robotics' : 'not_tool';
        log.warn({ videoId: video.videoId }, 'Classification failed, defaulting to negative');
      }

      log.info(
        { videoId: video.videoId, classification: video.classification, title: video.title.slice(0, 60) },
        'Video classified'
      );
      return video;
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled') classified.push(r.value);
  }

  const targetClass = isRobot ? 'is_robotics' : 'is_tool';
  const relevantVideos = classified.filter((v) => v.classification === targetClass);
  log.info({ total: classified.length, relevant: relevantVideos.length }, 'Classification complete');

  if (relevantVideos.length === 0) {
    log.warn('No relevant videos found after classification');
    return { classifiedVideos: classified, selectedVideos: [], status: 'scripting' };
  }

  // ── Step 2: Fetch full stats for relevant videos only ──
  log.info({ count: relevantVideos.length }, 'Step 2: Fetching stats for relevant videos');

  // Batch in groups of 50 (YouTube API limit)
  const videoIds = relevantVideos.map((v) => v.videoId);
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    try {
      const resp = await fetchWithKeyRotation((key) => {
        const detailUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
        detailUrl.searchParams.set('part', 'snippet,contentDetails,statistics');
        detailUrl.searchParams.set('id', batch.join(','));
        detailUrl.searchParams.set('key', key);
        return detailUrl.toString();
      }, 'stats');

      const data = await resp.json();
      const statsMap = new Map<string, { views: number; likes: number; comments: number; duration: number }>();

      for (const item of data.items || []) {
        statsMap.set(item.id, {
          views: parseInt(item.statistics.viewCount || '0'),
          likes: parseInt(item.statistics.likeCount || '0'),
          comments: parseInt(item.statistics.commentCount || '0'),
          duration: parseDuration(item.contentDetails.duration),
        });
      }

      // Update video objects with stats
      for (const video of relevantVideos) {
        const stats = statsMap.get(video.videoId);
        if (stats) {
          video.viewCount = stats.views;
          video.likeCount = stats.likes;
          video.commentCount = stats.comments;
          video.durationSeconds = stats.duration;
        }
      }
    } catch (error) {
      log.error({ error: (error as Error).message }, 'Stats fetch error');
    }
  }

  // ── Step 3: Check history + metadata filter ──
  log.info('Step 3: Metadata filtering');

  // Each segment type uses its own history table
  const isWeekly = state.segmentType === 'weekly';
  const historyTable = isRobot ? 'robot_youtube_sources'
    : isWeekly ? 'weekly_youtube_sources'
    : 'youtube_sources';

  // Weekly n8n does NOT filter by past video IDs; robot and daily do
  const usedIds = new Set(
    isWeekly ? [] :
    (db.prepare(`SELECT video_id FROM ${historyTable} WHERE used_in_episode IS NOT NULL`).all() as { video_id: string }[])
      .map((r) => r.video_id)
  );

  // Robot: min 270s (n8n), daily/weekly: min 300s
  const minDuration = isRobot ? 270 : MIN_DURATION_SEC;

  // Excluded videos (user-removed from review page)
  const excludedIds = new Set(state.excludedVideoIds || []);
  if (excludedIds.size > 0) {
    log.info({ excludedVideoIds: [...excludedIds] }, 'Excluding user-removed videos');
  }

  const filtered = relevantVideos.filter((v) => {
    if (excludedIds.has(v.videoId)) {
      log.debug({ videoId: v.videoId, title: v.title.slice(0, 40) }, 'Filtered: excluded by user');
      return false;
    }
    if (usedIds.size > 0 && usedIds.has(v.videoId)) {
      log.debug({ videoId: v.videoId, title: v.title.slice(0, 40) }, 'Filtered: already used');
      return false;
    }
    if (v.durationSeconds < minDuration) {
      log.debug({ videoId: v.videoId, duration: v.durationSeconds }, 'Filtered: too short');
      return false;
    }
    // Weekly: max 40 min (n8n)
    if (isWeekly && v.durationSeconds > MAX_DURATION_SEC_WEEKLY) {
      log.debug({ videoId: v.videoId, duration: v.durationSeconds }, 'Filtered: too long for weekly');
      return false;
    }
    if (v.viewCount < MIN_VIEWS) {
      log.debug({ videoId: v.videoId, views: v.viewCount }, 'Filtered: low views');
      return false;
    }
    if (v.likeCount < MIN_LIKES) {
      log.debug({ videoId: v.videoId, likes: v.likeCount }, 'Filtered: low likes');
      return false;
    }
    if (v.commentCount < MIN_COMMENTS) {
      log.debug({ videoId: v.videoId, comments: v.commentCount }, 'Filtered: low comments');
      return false;
    }
    return true;
  });

  // Sort by viewCount descending, take top 5
  filtered.sort((a, b) => b.viewCount - a.viewCount);
  const topVideos = filtered.slice(0, TOP_N);

  log.info(
    { afterFilter: filtered.length, selected: topVideos.length },
    'Metadata filter complete'
  );

  if (topVideos.length === 0) {
    log.warn('No videos passed metadata filter');
    return { classifiedVideos: classified, selectedVideos: [], status: 'scripting' };
  }

  // ── Step 4: Fetch transcripts for ONLY the top 5 ──
  log.info({ count: topVideos.length }, 'Step 4: Fetching transcripts');

  for (let i = 0; i < topVideos.length; i++) {
    const video = topVideos[i];
    try {
      video.transcript = await fetchTranscript(video.videoId);
      if (video.transcript.length < 100) {
        log.warn(
          { videoId: video.videoId, len: video.transcript.length },
          'Transcript very short or empty — script quality may be affected'
        );
      } else {
        log.info(
          { videoId: video.videoId, transcriptLen: video.transcript.length },
          'Transcript fetched'
        );
      }
    } catch (error) {
      log.warn({ videoId: video.videoId, error: (error as Error).message }, 'Transcript fetch failed');
      video.transcript = '';
    }

    // Save to segment-specific history table
    const saveTable = isRobot ? 'robot_youtube_sources'
      : isWeekly ? 'weekly_youtube_sources'
      : 'youtube_sources';
    db.prepare(
      `INSERT OR REPLACE INTO ${saveTable} (video_id, title, channel_name, published_at, view_count, like_count, comment_count, duration_seconds, transcript)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      video.videoId, video.title, video.channelName, video.publishedAt,
      video.viewCount, video.likeCount, video.commentCount, video.durationSeconds,
      video.transcript,
    );

    // Rate limit between Apify calls (matches n8n 等待8秒)
    if (i < topVideos.length - 1) {
      await sleep(TRANSCRIPT_DELAY_MS);
    }
  }

  log.info(
    { selected: topVideos.map((v) => ({ id: v.videoId, title: v.title.slice(0, 40), views: v.viewCount })) },
    'Final selected videos'
  );

  return {
    classifiedVideos: classified,
    selectedVideos: topVideos,
    status: 'scripting',
  };
}

// ── Sysdesign: skip LLM classification, fetch stats + transcripts for all ──

async function classifySysdesign(
  state: PipelineState,
  db: ReturnType<typeof getDb>,
): Promise<Partial<PipelineState>> {
  const videos = [...state.videos];

  // Fetch stats to get titles, channel names, durations
  const videoIds = videos.map((v) => v.videoId);
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    try {
      const resp = await fetchWithKeyRotation((key) => {
        const detailUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
        detailUrl.searchParams.set('part', 'snippet,contentDetails,statistics');
        detailUrl.searchParams.set('id', batch.join(','));
        detailUrl.searchParams.set('key', key);
        return detailUrl.toString();
      }, 'stats-sysdesign');

      const data = await resp.json();
      for (const item of data.items || []) {
        const video = videos.find((v) => v.videoId === item.id);
        if (video) {
          video.title = item.snippet.title;
          video.channelName = item.snippet.channelTitle;
          video.publishedAt = item.snippet.publishedAt;
          video.viewCount = parseInt(item.statistics.viewCount || '0');
          video.likeCount = parseInt(item.statistics.likeCount || '0');
          video.commentCount = parseInt(item.statistics.commentCount || '0');
          video.durationSeconds = parseDuration(item.contentDetails.duration);
        }
      }
    } catch (error) {
      log.error({ error: (error as Error).message }, 'Sysdesign stats fetch error');
    }
  }

  // Fetch transcripts for all videos
  log.info({ count: videos.length }, 'Sysdesign: fetching transcripts');
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    try {
      video.transcript = await fetchTranscript(video.videoId);
      log.info(
        { videoId: video.videoId, transcriptLen: video.transcript.length, title: video.title.slice(0, 60) },
        'Transcript fetched'
      );
    } catch (error) {
      log.warn({ videoId: video.videoId, error: (error as Error).message }, 'Transcript fetch failed');
      video.transcript = '';
    }
    if (i < videos.length - 1) await sleep(TRANSCRIPT_DELAY_MS);
  }

  // Build sourceLinks for publishing (original video URLs + titles)
  const sourceLinks: SourceLink[] = videos.map((v) => ({
    title: v.title || v.videoId,
    url: `https://www.youtube.com/watch?v=${v.videoId}`,
    viewCount: v.viewCount || 0,
    channelName: v.channelName || '',
    publishedAt: v.publishedAt || '',
  }));

  log.info(
    { selected: videos.map((v) => ({ id: v.videoId, title: v.title.slice(0, 40) })) },
    'Sysdesign: all videos selected'
  );

  return {
    classifiedVideos: videos,
    selectedVideos: videos,
    sourceLinks,
    status: 'scripting',
  };
}

// ── Helpers ──

function buildClassificationPrompt(video: VideoSource, isRobot: boolean): string {
  if (isRobot) {
    // n8n exact prompt for 機器人觀察週報 classification
    return `You are an AI classifier.

Your job is to analyze a YouTube video's title and description and determine whether it is valuable and relevant for robotics learners, robotics engineers, or anyone tracking robotics technology, research, and industry developments.

🎯 Core Rule
Classify as is_robotics only if the video provides useful, technical, or meaningful information about robotics, including:
1. new robotics research
2. robotics industry updates
3. breakthroughs in robot capabilities
4. quadruped / humanoid / mobile robot advancements
5. Robotics company news

✅ Classify as is_robotics if the video includes any of the following:
1. Robotics Research & Breakthroughs
- New papers from ICRA / IROS / RSS / CoRL
- University lab demos (CMU, Stanford, MIT, Berkeley, Tsinghua...)
- Quadruped, humanoid, robotic arm updates

2. Robotics Industry Updates
- Boston Dynamics / Agility / Unitree / Tesla Optimus
- Warehouse, logistics, manufacturing robotics
- Medical robotics, drone robotics, autonomous systems
- Hardware upgrades (LiDAR, sensors, compute modules)
- Any interesting robotics industry news update

❌ Classify as non_robotics if the video is:
1. NOT relevant to robotics
2. Low-value
3. Non-Robotics content such as
- Programming unrelated to robotics
4. Language & Region Exclusion
- Non-English videos (title or description mostly non-English)
- India-origin content when primarily non-technical or low-value
(identified by Hindi/Tamil text, location like Mumbai/Delhi, or creator names)
(Technical robotics content from India is allowed — reject only low-value, non-engineering content.)

🧾 Output:
Return "true" if the video is relevant and useful for Robotics enthusiastics and investors.
Return "false" if the video is not relevant to robotics industry or low value

Input Video:
${video.title} ${video.channelName}`;
  }

  // n8n exact prompt for daily/weekly classification
  return `You are an AI classifier. Your task is to analyze a YouTube video's title and description and determine whether the content is valuable for people learning or using AI — especially those seeking practical tools, impactful AI tool and LLM updates, or real-world examples.

🎯 Core Rule:
Mark as true only if the video delivers useful, relevant, and applicable AI content — something that a AI learner, developer, or workflow builder, or anyone interested in learning AI can learn from or act on.

✅ Mark as true if the video includes:

A major AI technology breakthrough or significant LLM release (e.g., GPT launch, Claude, Google AI Products, new multimodal models)

A hands-on demo or tutorial of AI tools (e.g., ChatGPT, Gemini, Claude, Midjourney, Notion AI)

A hands-on demo, actual product walkthrough, or implementation of major AI tools or releases

Actual AI-driven automation examples (e.g., building agents, bots, workflows)

Integrations with other platforms (e.g., Zapier + GPT, Slack bots, Excel + AI)

Step-by-step guides, practical walkthroughs, or repeatable workflows

Clear use cases showing how AI improves productivity, marketing, customer support, content creation, etc.

📌 Mark as false if the video:

- Primarily discusses AI features hypothetically, or as speculation/hype/news only without action steps
- Includes challenge videos, "let's test AI" for entertainment, or gaming-style experiments
- Originates from India, based on:
    -  Language clues (Hindi, Tamil, etc.)
    - Location references (Mumbai, Delhi, etc.)
    - Indian creator/channel names
    - Is non-English (title or description has mostly non-English text)
- Focuses only on:
  - AI policy or regulation updates without application
  - Commentary, future speculation, or debates
  - Hype, reactions, or non-actionable summaries

🧾 Output:
Return "true" if the video is relevant and useful for AI learners.
Return "false" if it lacks applicability, is language-excluded, or violates exclusion rules.

Input Video:
Title: ${video.title}
Channel: ${video.channelName}`;
}

function parseDuration(iso8601: string): number {
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] || '0') * 3600) +
         (parseInt(match[2] || '0') * 60) +
         parseInt(match[3] || '0');
}

/**
 * Fetch transcript using Apify YouTube Transcript Scraper.
 * Uses karamelo~youtube-transcripts actor.
 */
async function fetchTranscript(videoId: string): Promise<string> {
  const apifyToken = process.env.APIFY_API_TOKEN;
  if (!apifyToken) return '';

  const resp = await withRetry(
    async () => {
      const r = await fetch(
        `https://api.apify.com/v2/acts/karamelo~youtube-transcripts/run-sync-get-dataset-items?token=${apifyToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            urls: [`https://www.youtube.com/watch?v=${videoId}`],
            outputFormat: 'singleStringText',
          }),
        }
      );
      if (!r.ok) throw new Error(`Apify ${r.status}`);
      return r;
    },
    { label: `apify-transcript:${videoId}` },
  );
  const data = await resp.json();
  return data?.[0]?.captions || data?.[0]?.text || data?.[0]?.transcript || '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
