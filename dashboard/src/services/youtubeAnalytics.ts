import { createChildLogger } from '@/lib/logger';
import { getDb } from '@/db';
import { fetchWithKeyRotation } from '@/lib/youtubeKeys';

const log = createChildLogger('youtube-analytics');

const CHANNEL_ID = 'UCNyBkFPz_IPWainccK0YbOA'; // AI 懶人報

interface ChannelStatistics {
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
}

interface VideoItem {
  id: string;
  title: string;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
}

/**
 * Fetch channel-level statistics from YouTube Data API v3 (no OAuth, just API key).
 */
async function fetchChannelStats(): Promise<ChannelStatistics> {
  const resp = await fetchWithKeyRotation(
    (key) => `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${CHANNEL_ID}&key=${key}`,
    'channel-stats'
  );

  const data = await resp.json();
  const stats = data.items?.[0]?.statistics;

  if (!stats) {
    throw new Error(`No channel data returned: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return {
    subscriberCount: Number(stats.subscriberCount ?? 0),
    viewCount: Number(stats.viewCount ?? 0),
    videoCount: Number(stats.videoCount ?? 0),
  };
}

/**
 * Fetch recent videos (last 50) with their statistics.
 */
async function fetchRecentVideos(): Promise<VideoItem[]> {
  // Step 1: Get upload playlist items
  const playlistResp = await fetchWithKeyRotation(
    (key) =>
      `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${CHANNEL_ID}&key=${key}`,
    'channel-content-details'
  );

  const channelData = await playlistResp.json();
  const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

  if (!uploadsPlaylistId) {
    throw new Error('Could not find uploads playlist');
  }

  // Step 2: Get playlist items (last 50 videos)
  const itemsResp = await fetchWithKeyRotation(
    (key) =>
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50&key=${key}`,
    'playlist-items'
  );

  const itemsData = await itemsResp.json();
  const videoIds = (itemsData.items ?? [])
    .map((item: { snippet?: { resourceId?: { videoId?: string } } }) => item.snippet?.resourceId?.videoId)
    .filter(Boolean) as string[];

  if (videoIds.length === 0) {
    return [];
  }

  // Step 3: Get video statistics in batches of 50
  const videosResp = await fetchWithKeyRotation(
    (key) =>
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds.join(',')}&key=${key}`,
    'video-stats'
  );

  const videosData = await videosResp.json();

  return (videosData.items ?? []).map((v: {
    id: string;
    snippet?: { title: string; publishedAt: string };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  }) => ({
    id: v.id,
    title: v.snippet?.title ?? 'Unknown',
    publishedAt: v.snippet?.publishedAt ?? '',
    views: Number(v.statistics?.viewCount ?? 0),
    likes: Number(v.statistics?.likeCount ?? 0),
    comments: Number(v.statistics?.commentCount ?? 0),
  }));
}

export interface YoutubeSyncResult {
  channelStats: ChannelStatistics | null;
  videosCount: number;
  snapshotDate: string;
  error?: string;
}

/**
 * Main sync function: fetch data from YouTube API, store in DB.
 * Can be called manually or via cron.
 */
export async function syncYoutubeAnalytics(): Promise<YoutubeSyncResult> {
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  const db = getDb();

  try {
    const channelStats = await fetchChannelStats();
    log.info({ ...channelStats, date: today }, 'Channel stats fetched');

    // Upsert channel daily snapshot
    db.prepare(`
      INSERT INTO youtube_channel_stats (snapshot_date, subscriber_count, view_count, video_count)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(snapshot_date) DO UPDATE SET
        subscriber_count = excluded.subscriber_count,
        view_count = excluded.view_count,
        video_count = excluded.video_count,
        created_at = datetime('now')
    `).run(today, channelStats.subscriberCount, channelStats.viewCount, channelStats.videoCount);

    // Fetch and store recent videos
    const videos = await fetchRecentVideos();
    log.info({ count: videos.length, date: today }, 'Video stats fetched');

    if (videos.length > 0) {
      const upsertVideo = db.prepare(`
        INSERT INTO youtube_video_stats (video_id, title, published_at, snapshot_date, views, likes, comments)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(video_id, snapshot_date) DO UPDATE SET
          title = excluded.title,
          views = excluded.views,
          likes = excluded.likes,
          comments = excluded.comments,
          created_at = datetime('now')
      `);

      const insertMany = db.transaction((items: typeof videos) => {
        for (const v of items) {
          upsertVideo.run(v.id, v.title, v.publishedAt, today, v.views, v.likes, v.comments);
        }
      });

      insertMany(videos);
    }

    return {
      channelStats,
      videosCount: videos.length,
      snapshotDate: today,
    };
  } catch (err) {
    const message = (err as Error).message;
    log.error({ error: message }, 'YouTube analytics sync failed');
    return {
      channelStats: null,
      videosCount: 0,
      snapshotDate: today,
      error: message,
    };
  }
}

/**
 * Get stored analytics data for the UI.
 */
export function getYoutubeAnalyticsData(options?: { sort?: string; order?: string }) {
  const db = getDb();
  const order = options?.order === 'asc' ? 'ASC' : 'DESC';

  // Latest channel snapshot (most recent first)
  const channelSnapshots = db.prepare(`
    SELECT * FROM youtube_channel_stats ORDER BY snapshot_date ASC
  `).all() as Array<{
    snapshot_date: string;
    subscriber_count: number;
    view_count: number;
    video_count: number;
  }>;

  // Latest video stats (most recent per video)
  const latestVideos = db.prepare(`
    SELECT * FROM youtube_video_stats
    WHERE (video_id, snapshot_date) IN (
      SELECT video_id, MAX(snapshot_date) FROM youtube_video_stats GROUP BY video_id
    )
    ORDER BY views ${order} LIMIT 50
  `).all() as Array<{
    video_id: string;
    title: string;
    published_at: string;
    snapshot_date: string;
    views: number;
    likes: number;
    comments: number;
  }>;

  // Summary
  const latest = channelSnapshots[channelSnapshots.length - 1];
  const first = channelSnapshots[0];
  const earliestWithData = channelSnapshots.find(s => s.view_count > 0);

  const subscriberGrowth = latest && earliestWithData && latest.snapshot_date !== earliestWithData.snapshot_date
    ? latest.subscriber_count - earliestWithData.subscriber_count
    : 0;

  const viewGrowth = latest && earliestWithData && latest.snapshot_date !== earliestWithData.snapshot_date
    ? latest.view_count - earliestWithData.view_count
    : 0;

  return {
    channelSnapshots,
    latestVideos,
    summary: {
      currentSubscribers: latest?.subscriber_count ?? 0,
      currentViews: latest?.view_count ?? 0,
      currentVideos: latest?.video_count ?? 0,
      subscriberGrowth,
      viewGrowth,
      totalSnapshots: channelSnapshots.length,
      firstSnapshotDate: channelSnapshots[0]?.snapshot_date ?? null,
      latestSnapshotDate: latest?.snapshot_date ?? null,
    },
  };
}