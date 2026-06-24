import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { fetchWithKeyRotation } from '@/lib/youtubeKeys';

const log = createChildLogger('channel-crawler');

export interface ResolvedChannel {
  channelId: string;
  uploadsPlaylistId: string;
  title: string;
  thumbnailUrl: string | null;
  handle: string;        // normalized with leading '@'
}

export interface ChannelVideo {
  videoId: string;
  title: string;
  publishedAt: string | null;
}

/** Extract a bare handle (no '@') from a channel URL or raw handle. */
export function parseHandle(urlOrHandle: string): string {
  const m = urlOrHandle.match(/@([A-Za-z0-9_.\-]+)/);
  if (m) return m[1];
  return urlOrHandle.replace(/^@/, '').trim();
}

/** Resolve a YouTube channel URL/handle → channelId + uploads playlist + metadata. */
export async function resolveChannel(urlOrHandle: string): Promise<ResolvedChannel> {
  const handle = parseHandle(urlOrHandle);
  if (!handle) throw new Error('Could not parse a channel handle from input');
  const resp = await fetchWithKeyRotation(
    (k) => `https://www.googleapis.com/youtube/v3/channels?part=contentDetails,snippet&forHandle=${encodeURIComponent(handle)}&key=${k}`,
    `channels:${handle}`,
  );
  const data = await resp.json();
  const item = data.items?.[0];
  if (!item) throw new Error(`No YouTube channel found for @${handle}`);
  return {
    channelId: item.id,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
    title: item.snippet.title,
    thumbnailUrl: item.snippet.thumbnails?.default?.url || null,
    handle: '@' + handle,
  };
}

/** List the latest `limit` videos from a channel's uploads playlist. */
export async function listLatestVideos(uploadsPlaylistId: string, limit: number): Promise<ChannelVideo[]> {
  const resp = await fetchWithKeyRotation(
    (k) => `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${uploadsPlaylistId}&maxResults=${limit}&key=${k}`,
    `playlist:${uploadsPlaylistId}`,
  );
  const data = await resp.json();
  return (data.items || [])
    .map((v: Record<string, any>) => ({
      videoId: v.contentDetails?.videoId || v.snippet?.resourceId?.videoId,
      title: v.snippet?.title || '',
      publishedAt: v.contentDetails?.videoPublishedAt || v.snippet?.publishedAt || null,
    }))
    .filter((v: ChannelVideo) => !!v.videoId);
}

/** Insert a resolved channel (idempotent on channel_id). Returns the new row id (0 if ignored). */
export function addChannel(c: ResolvedChannel, fetchCount = 5): number {
  const db = getDb();
  const r = db.prepare(
    `INSERT OR IGNORE INTO channels (platform, handle, channel_id, uploads_playlist_id, title, thumbnail_url, fetch_count)
     VALUES ('youtube', ?, ?, ?, ?, ?, ?)`,
  ).run(c.handle, c.channelId, c.uploadsPlaylistId, c.title, c.thumbnailUrl, fetchCount);
  return Number(r.lastInsertRowid);
}
