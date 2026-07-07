/**
 * Candidate crawler — feeds the /candidates 選題板.
 *
 * Two sources, metadata ONLY (no transcript, no LLM — cheap enough to run daily):
 *   - query:   the existing daily search keywords → search.list (order=viewCount),
 *              kept only if view_count >= candidate_min_views (default 10k).
 *   - channel: curated AI-podcast channels → latest uploads within RECENCY_DAYS,
 *              NO view threshold (these are hand-picked, take everything recent).
 *
 * Tommy reviews the board and manually makes episodes; there is no auto-generation.
 * Transcription happens later, only when a candidate is turned into an episode.
 */

import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { fetchWithKeyRotation, getYouTubeApiKey } from '@/lib/youtubeKeys';
import { resolveChannel, listLatestVideos } from '@/services/inspiration/channelCrawler';
import { getSearchQueries } from '@/services/pipeline/nodes/fetchYoutube';

const log = createChildLogger('candidate-crawler');

// Queries are high-volume/noisy → tight window. Channels release full episodes ~weekly and
// post daily Shorts in between, so a tight window often lands between episodes (only clips,
// which the 6-min filter then drops → channel looks empty). Give channels 2 weeks so each
// channel's latest long-form episode(s) reliably land.
const QUERY_RECENCY_DAYS = 5;
const CHANNEL_RECENCY_DAYS = 14;
const CHANNEL_FETCH = 15; // latest uploads to scan per channel (clips + episodes; filtered after)
const DEFAULT_MIN_VIEWS = 10_000;
const RETENTION_DAYS = 14;
const MIN_DURATION_SEC = 360; // skip anything under 6 min (Shorts, clips) for both sources.
                              // Duration 0 = live/premiere with no length yet → also skipped.

// Curated AI-podcast channels. Overridable via settings `candidate_channels` (JSON array).
// Handles are resolved best-effort at crawl time; a bad handle just warns + skips.
const DEFAULT_CHANNELS = [
  '@NoPriorsPodcast',
  '@latentspacepod',
  '@CognitiveRevolutionPodcast',
  '@DwarkeshPatel',
  '@ycombinator',
  '@LennysPodcast',
];

function getSetting(key: string): string | undefined {
  try {
    return (getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  } catch {
    return undefined;
  }
}

function getMinViews(): number {
  const n = parseInt(getSetting('candidate_min_views') || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MIN_VIEWS;
}

function getChannelHandles(): string[] {
  const raw = getSetting('candidate_channels');
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr.map(String);
    } catch { /* fall through to default */ }
  }
  return DEFAULT_CHANNELS;
}

/** ISO 8601 duration (PT#H#M#S) → seconds. */
function parseDuration(iso: string): number {
  const m = iso?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

interface Stats {
  title: string;
  channelName: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  viewCount: number;
  durationSeconds: number;
  audioLang: string | null;
}

// Keep English content only. Drop titles written in a non-Latin script — CJK
// (Chinese/Japanese/Korean), Indic, Thai, Arabic, Cyrillic, Hebrew — and drop videos whose
// audio track is explicitly non-English (e.g. Spanish 'es', Hindi 'hi'). ponytail:
// deterministic heuristic — romanized-Spanish with no audio-lang tag may still leak; escalate
// to an LLM language check only if that becomes a real problem. (Greek left out: α/β/π etc.
// appear in English tech titles.)
const NON_LATIN_RE = /[぀-ヿ㐀-鿿가-힯ऀ-෿฀-๿؀-ۿЀ-ӿ֐-׿]/;
export function isNonEnglish(title: string, audioLang: string | null): boolean {
  if (NON_LATIN_RE.test(title)) return true;
  if (audioLang && !audioLang.toLowerCase().startsWith('en')) return true;
  return false;
}

/** Batch videos.list (50/call) → per-videoId metadata + stats. */
async function fetchStats(videoIds: string[]): Promise<Map<string, Stats>> {
  const out = new Map<string, Stats>();
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    try {
      const resp = await fetchWithKeyRotation((key) => {
        const u = new URL('https://www.googleapis.com/youtube/v3/videos');
        u.searchParams.set('part', 'snippet,contentDetails,statistics');
        u.searchParams.set('id', batch.join(','));
        u.searchParams.set('key', key);
        return u.toString();
      }, 'candidate-stats');
      const data = await resp.json();
      for (const item of data.items || []) {
        const sn = item.snippet || {};
        out.set(item.id, {
          title: sn.title || '',
          channelName: sn.channelTitle || '',
          thumbnailUrl: sn.thumbnails?.maxres?.url || sn.thumbnails?.standard?.url || sn.thumbnails?.high?.url || sn.thumbnails?.medium?.url || null,
          publishedAt: sn.publishedAt || null,
          viewCount: parseInt(item.statistics?.viewCount || '0', 10),
          durationSeconds: parseDuration(item.contentDetails?.duration || ''),
          audioLang: sn.defaultAudioLanguage || sn.defaultLanguage || null,
        });
      }
    } catch (e) {
      log.error({ err: (e as Error).message }, 'candidate stats fetch failed');
    }
  }
  return out;
}

/** Search the existing daily keywords for recent, high-view videos. */
async function collectQueryVideoIds(publishedAfter: string): Promise<Map<string, string>> {
  const map = new Map<string, string>(); // videoId → query
  const queries = getSearchQueries().daily || [];
  for (const q of queries) {
    try {
      const resp = await fetchWithKeyRotation((key) => {
        const u = new URL('https://www.googleapis.com/youtube/v3/search');
        u.searchParams.set('part', 'snippet');
        u.searchParams.set('q', q);
        u.searchParams.set('type', 'video');
        u.searchParams.set('order', 'viewCount');
        u.searchParams.set('maxResults', '5');
        u.searchParams.set('regionCode', 'US');
        u.searchParams.set('relevanceLanguage', 'en');
        u.searchParams.set('publishedAfter', publishedAfter);
        u.searchParams.set('key', key);
        return u.toString();
      }, `candidate-search:${q}`);
      const data = await resp.json();
      for (const item of data.items || []) {
        const id = item.id?.videoId;
        if (id && !map.has(id)) map.set(id, q);
      }
    } catch (e) {
      log.warn({ q, err: (e as Error).message }, 'candidate search query failed');
    }
  }
  return map;
}

/** Latest uploads from curated channels, published within RECENCY_DAYS. */
async function collectChannelVideoIds(cutoff: Date): Promise<Map<string, string>> {
  const map = new Map<string, string>(); // videoId → handle
  for (const handle of getChannelHandles()) {
    try {
      const ch = await resolveChannel(handle);
      const videos = await listLatestVideos(ch.uploadsPlaylistId, CHANNEL_FETCH);
      for (const v of videos) {
        if (v.publishedAt && new Date(v.publishedAt) < cutoff) continue;
        if (!map.has(v.videoId)) map.set(v.videoId, ch.handle);
      }
    } catch (e) {
      log.warn({ handle, err: (e as Error).message }, 'candidate channel crawl failed, skipping');
    }
  }
  return map;
}

function upsert(row: {
  videoId: string; stats: Stats; source: 'query' | 'channel'; sourceDetail: string;
}): boolean {
  const r = getDb().prepare(
    `INSERT OR IGNORE INTO episode_candidates
       (video_id, title, channel_name, thumbnail_url, published_at, view_count, duration_seconds, source, source_detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.videoId, row.stats.title, row.stats.channelName, row.stats.thumbnailUrl,
    row.stats.publishedAt, row.stats.viewCount, row.stats.durationSeconds,
    row.source, row.sourceDetail,
  );
  return r.changes > 0;
}

export interface CrawlResult { queryAdded: number; channelAdded: number; deleted: number }

/** Run both crawls, dedup by video_id (INSERT OR IGNORE preserves existing status), prune old rows. */
export async function crawlAll(): Promise<CrawlResult> {
  if (!getYouTubeApiKey()) {
    log.warn('No YouTube API key — skipping candidate crawl');
    return { queryAdded: 0, channelAdded: 0, deleted: 0 };
  }
  const now = Date.now();
  const minViews = getMinViews();

  const queryIds = await collectQueryVideoIds(new Date(now - QUERY_RECENCY_DAYS * 86_400_000).toISOString());
  const channelIds = await collectChannelVideoIds(new Date(now - CHANNEL_RECENCY_DAYS * 86_400_000));

  // One stats call for everything (channel rows override query source if a video appears in both).
  const stats = await fetchStats([...new Set([...queryIds.keys(), ...channelIds.keys()])]);

  let queryAdded = 0;
  for (const [videoId, q] of queryIds) {
    if (channelIds.has(videoId)) continue; // prefer channel provenance
    const s = stats.get(videoId);
    if (!s || s.viewCount < minViews) continue;
    if (s.durationSeconds < MIN_DURATION_SEC) continue;
    if (isNonEnglish(s.title, s.audioLang)) continue;
    if (upsert({ videoId, stats: s, source: 'query', sourceDetail: q })) queryAdded++;
  }

  let channelAdded = 0;
  for (const [videoId, handle] of channelIds) {
    const s = stats.get(videoId);
    if (!s) continue;
    if (s.durationSeconds < MIN_DURATION_SEC) continue;
    if (isNonEnglish(s.title, s.audioLang)) continue;
    if (upsert({ videoId, stats: s, source: 'channel', sourceDetail: handle })) channelAdded++;
  }

  // Prune stale rows the user never acted on (keep saved + used forever).
  const del = getDb().prepare(
    `DELETE FROM episode_candidates
     WHERE status NOT IN ('saved', 'used')
       AND crawled_at < datetime('now', ?)`,
  ).run(`-${RETENTION_DAYS} days`);

  // Tag the newly-added rows (best-effort; a failure just leaves them untagged for next run).
  try {
    const { tagUntagged } = await import('@/services/candidateTagger');
    await tagUntagged();
  } catch (e) {
    log.warn({ err: (e as Error).message }, 'candidate tagging skipped');
  }

  const result = { queryAdded, channelAdded, deleted: del.changes };
  log.info(result, 'Candidate crawl complete');
  return result;
}
