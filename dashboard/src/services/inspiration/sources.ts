import fs from 'fs';
import os from 'os';
import path from 'path';
import { createChildLogger } from '@/lib/logger';
import { withRetry } from '@/lib/retry';
import { transcribeAudio } from '@/services/subtitleGenerator';
import { resolveAppleEpisode } from './applePodcast';
import { fetchWithKeyRotation } from '@/lib/youtubeKeys';
import type { IngestInput, ResolvedSource, SourceType } from './types';

const log = createChildLogger('inspiration-sources');

/** Decode common HTML entities — APIFY transcripts come HTML-encoded (e.g. &#39; → '). */
export function decodeHtmlEntities(s: string): string {
  if (!s) return s;
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export interface VideoMeta { title: string | null; channelName: string | null; thumbnailUrl: string | null; publishedAt: string | null }

/** Fetch a YouTube video's title/channel/thumbnail/publishedAt via the Data API. Returns nulls on failure. */
export async function fetchYouTubeVideoMeta(videoId: string): Promise<VideoMeta> {
  try {
    const resp = await fetchWithKeyRotation(
      (k) => `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${k}`,
      `video-meta:${videoId}`,
    );
    const data = await resp.json();
    const sn = data.items?.[0]?.snippet;
    if (!sn) return { title: null, channelName: null, thumbnailUrl: null, publishedAt: null };
    return {
      title: sn.title || null,
      channelName: sn.channelTitle || null,
      thumbnailUrl: sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url || null,
      publishedAt: sn.publishedAt || null,
    };
  } catch (e) {
    log.warn({ videoId, err: (e as Error).message }, 'video meta fetch failed');
    return { title: null, channelName: null, thumbnailUrl: null, publishedAt: null };
  }
}

/** Decide which kind of source an input is. */
export function detectSourceType(input: IngestInput): SourceType {
  if (input.text && !input.url) return 'manual';
  const u = input.url || '';
  if (/youtube\.com|youtu\.be/i.test(u)) return 'youtube';
  if (/podcasts\.apple\.com/i.test(u)) return 'apple_podcast';
  throw new Error('Unrecognized URL — expected a YouTube or Apple Podcasts link');
}

export function youTubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([\w-]{11})/);
  return m?.[1] || null;
}

/** Fetch a YouTube transcript via APIFY (same actor used by the pipeline). */
async function fetchYouTubeTranscript(url: string): Promise<string> {
  const apifyToken = process.env.APIFY_API_TOKEN;
  if (!apifyToken) throw new Error('APIFY_API_TOKEN not set');
  const videoId = youTubeId(url);
  if (!videoId) throw new Error('Could not parse YouTube video id');
  const resp = await withRetry(async () => {
    const r = await fetch(
      `https://api.apify.com/v2/acts/karamelo~youtube-transcripts/run-sync-get-dataset-items?token=${apifyToken}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [`https://www.youtube.com/watch?v=${videoId}`], outputFormat: 'singleStringText' }) },
    );
    if (!r.ok) throw new Error(`Apify ${r.status}`);
    return r;
  }, { label: `apify-transcript:${videoId}` });
  const data = await resp.json();
  const raw = data?.[0]?.captions || data?.[0]?.text || data?.[0]?.transcript || '';
  return decodeHtmlEntities(raw);
}

/** Download an audio URL to a temp file; returns the path (caller deletes). */
async function downloadAudio(audioUrl: string): Promise<string> {
  const r = await fetch(audioUrl);
  if (!r.ok) throw new Error(`Audio download ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const tmp = path.join(os.tmpdir(), `inspiration-${Date.now()}.mp3`);
  fs.writeFileSync(tmp, buf);
  return tmp;
}

/**
 * Resolve any IngestInput to a transcript + metadata.
 * Loop-ready: a future channel pipeline calls this per episode/video.
 */
export async function resolveSource(input: IngestInput): Promise<ResolvedSource> {
  const sourceType = detectSourceType(input);

  if (sourceType === 'manual') {
    return { sourceType, title: input.title || null, channelName: null, thumbnailUrl: null, transcript: input.text!.trim(), costUsd: 0, publishedAt: input.publishedAt ?? null };
  }

  if (sourceType === 'youtube') {
    const transcript = await fetchYouTubeTranscript(input.url!);
    if (!transcript.trim()) throw new Error('YouTube transcript was empty');
    const vid = youTubeId(input.url!);
    const meta = vid ? await fetchYouTubeVideoMeta(vid) : { title: null, channelName: null, thumbnailUrl: null, publishedAt: null };
    // Channel crawls already carry the playlist publishedAt; fall back to the video snippet's.
    return { sourceType, title: input.title || meta.title, channelName: meta.channelName, thumbnailUrl: meta.thumbnailUrl, transcript, costUsd: 0, publishedAt: input.publishedAt ?? meta.publishedAt };
  }

  // apple_podcast
  const ep = await resolveAppleEpisode(input.url!);
  const audioPath = await downloadAudio(ep.audioUrl);
  try {
    const t = await transcribeAudio(audioPath, { language: 'zh', chunkLongAudio: true });
    // Whisper pricing ≈ $0.006 / minute.
    const costUsd = ((t.duration || 0) / 60) * 0.006;
    log.info({ durationSec: t.duration, costUsd: costUsd.toFixed(3) }, 'Podcast transcribed');
    return { sourceType, title: input.title || ep.title, channelName: ep.channelName, thumbnailUrl: ep.thumbnailUrl, transcript: t.text, costUsd, publishedAt: input.publishedAt ?? ep.publishedAt };
  } finally {
    try { fs.unlinkSync(audioPath); } catch { /* best effort */ }
  }
}
