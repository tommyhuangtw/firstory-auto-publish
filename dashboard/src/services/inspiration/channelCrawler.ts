import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { fetchWithKeyRotation } from '@/lib/youtubeKeys';
import { createSourceRow, runIngest } from '@/services/inspiration/pipeline';
import type { IngestInput } from './types';

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
  const uploads = item.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error(`Channel @${handle} has no uploads playlist`);
  return {
    channelId: item.id,
    uploadsPlaylistId: uploads,
    title: item.snippet?.title || handle,
    thumbnailUrl: item.snippet?.thumbnails?.default?.url || null,
    handle: '@' + handle,
  };
}

/** List the latest `limit` videos from a channel's uploads playlist. */
export async function listLatestVideos(uploadsPlaylistId: string, limit: number): Promise<ChannelVideo[]> {
  const maxResults = Math.max(1, Math.min(50, Math.floor(limit) || 5)); // Data API caps maxResults at 50
  const resp = await fetchWithKeyRotation(
    (k) => `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(uploadsPlaylistId)}&maxResults=${maxResults}&key=${k}`,
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

export interface ChannelRow {
  id: number;
  channel_id: string;
  uploads_playlist_id: string;
  title: string | null;
  fetch_count: number;
}

// In-flight guards: prevent overlapping crawls of the same channel (or two crawl-all runs) from
// racing the external_id dedup check and producing duplicate ingests. Single-process only.
const crawlInFlight = new Set<number>();
let crawlAllInFlight = false;

/** Crawl one channel: list latest, skip already-ingested (by external_id), ingest the rest sequentially. */
export async function crawlChannel(channelRow: ChannelRow): Promise<{ discovered: number; ingested: number; skipped: number }> {
  if (crawlInFlight.has(channelRow.id)) {
    log.warn({ channelId: channelRow.id }, 'crawl already in flight for this channel, skipping');
    return { discovered: 0, ingested: 0, skipped: 0 };
  }
  crawlInFlight.add(channelRow.id);
  try {
  const db = getDb();
  const videos = await listLatestVideos(channelRow.uploads_playlist_id, channelRow.fetch_count);
  let ingested = 0;
  let skipped = 0;
  for (const v of videos) {
    // Dedup by external_id regardless of status: a previously-failed video (e.g. a Short with no
    // transcript) stays skipped on re-crawl rather than being re-attempted every time.
    const exists = db.prepare('SELECT 1 FROM content_summaries WHERE external_id = ?').get(v.videoId);
    if (exists) { skipped++; continue; }
    const input: IngestInput = {
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      title: v.title,
      channelId: channelRow.id,
      externalId: v.videoId,
      publishedAt: v.publishedAt,
    };
    const sourceId = createSourceRow(input);
    try {
      await runIngest(sourceId, input);
      ingested++;
    } catch (e) {
      log.warn({ videoId: v.videoId, err: (e as Error).message }, 'ingest failed during crawl');
    }
  }
  db.prepare("UPDATE channels SET last_crawled_at = datetime('now') WHERE id = ?").run(channelRow.id);
  log.info({ channel: channelRow.title, discovered: videos.length, ingested, skipped }, 'Channel crawled');
  return { discovered: videos.length, ingested, skipped };
  } finally {
    crawlInFlight.delete(channelRow.id);
  }
}

/** Crawl every active channel sequentially. */
export async function crawlAllActive(): Promise<{ channels: number; ingested: number; skipped: number }> {
  if (crawlAllInFlight) {
    log.warn('crawl-all already in flight, skipping');
    return { channels: 0, ingested: 0, skipped: 0 };
  }
  crawlAllInFlight = true;
  try {
  const db = getDb();
  const rows = db.prepare(
    'SELECT id, channel_id, uploads_playlist_id, title, fetch_count FROM channels WHERE active = 1',
  ).all() as ChannelRow[];
  let ingested = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      const r = await crawlChannel(row);
      ingested += r.ingested;
      skipped += r.skipped;
    } catch (e) {
      log.warn({ channelId: row.id, err: (e as Error).message }, 'channel crawl failed, continuing');
    }
  }
  return { channels: rows.length, ingested, skipped };
  } finally {
    crawlAllInFlight = false;
  }
}

const DEFAULT_HANDLES = ['@AlexHormozi', '@nateherk', '@garytalksstuff', '@SiliconValleyGirl', '@LennysPodcast'];

/** Idempotently resolve + insert the default channels. Returns how many were newly added. */
export async function seedDefaultChannels(): Promise<number> {
  const db = getDb();
  let added = 0;
  for (const h of DEFAULT_HANDLES) {
    if (db.prepare('SELECT 1 FROM channels WHERE handle = ?').get(h)) continue;
    try {
      const c = await resolveChannel(h);
      if (addChannel(c) > 0) added++;
    } catch (e) {
      log.warn({ handle: h, err: (e as Error).message }, 'seed resolve failed');
    }
  }
  return added;
}
