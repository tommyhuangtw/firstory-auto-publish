import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('apple-podcast');

export interface AppleEpisode {
  title: string | null;
  channelName: string | null;
  audioUrl: string;
  thumbnailUrl: string | null;
}

/** Pull podcastId (id…) and episodeId (?i=…) out of an Apple Podcasts URL. */
export function parseAppleUrl(url: string): { podcastId?: string; episodeId?: string } {
  const idMatch = url.match(/\/id(\d+)/);
  const epMatch = url.match(/[?&]i=(\d+)/);
  return { podcastId: idMatch?.[1], episodeId: epMatch?.[1] };
}

/** Look up a podcast's episodes via iTunes. Pass the *podcast* collection ID, not the episode ID. */
async function itunesPodcastLookup(podcastId: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(
    `https://itunes.apple.com/lookup?id=${podcastId}&entity=podcastEpisode&limit=200`
  );
  if (!r.ok) throw new Error(`iTunes lookup ${r.status}`);
  const data = await r.json();
  return (data?.results || []) as Record<string, unknown>[];
}

/**
 * Find a specific episode's `<item>` in an RSS feed by guid, falling back to
 * normalized title match. Returns the matching item's enclosure URL + title.
 * Throws if the episode cannot be located — never silently returns the wrong episode.
 */
async function findEpisodeInFeed(
  feedUrl: string,
  episodeGuid: string | undefined,
  trackName: string
): Promise<{ audioUrl: string; title: string }> {
  const r = await fetch(feedUrl);
  if (!r.ok) throw new Error(`RSS fetch ${r.status}`);
  const xml = await r.text();

  // Split into <item> blocks
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  if (itemBlocks.length === 0) throw new Error('No <item> blocks found in RSS feed');

  function extractField(block: string, tag: string): string | undefined {
    const m = block.match(new RegExp(`<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${tag}>`, 'i'));
    return m?.[1]?.trim();
  }

  function extractAttr(block: string, tag: string, attr: string): string | undefined {
    const m = block.match(new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["']`, 'i'));
    return m?.[1];
  }

  function normalizeTitle(t: string): string {
    return t.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  const normalizedTarget = normalizeTitle(trackName);

  // 1. Try guid match (most reliable)
  if (episodeGuid) {
    for (const block of itemBlocks) {
      const guid = extractField(block, 'guid') || extractAttr(block, 'guid', 'isPermaLink') || '';
      if (guid === episodeGuid) {
        const audioUrl = extractAttr(block, 'enclosure', 'url');
        const title = extractField(block, 'title');
        if (audioUrl) return { audioUrl, title: title || trackName };
      }
    }
    log.warn({ episodeGuid }, 'guid not found in feed, trying title match');
  }

  // 2. Fallback: normalized title match
  for (const block of itemBlocks) {
    const itemTitle = extractField(block, 'title') || '';
    if (normalizeTitle(itemTitle) === normalizedTarget) {
      const audioUrl = extractAttr(block, 'enclosure', 'url');
      const title = extractField(block, 'title');
      if (audioUrl) return { audioUrl, title: title || trackName };
    }
  }

  throw new Error(
    `Could not locate episode "${trackName}" in feed (guid: ${episodeGuid ?? 'none'})`
  );
}

/** First <enclosure url="…"> in an RSS feed (newest episode), with show title.
 *  Only used when no specific episodeId is requested. */
async function firstEnclosureFromFeed(feedUrl: string): Promise<AppleEpisode> {
  const r = await fetch(feedUrl);
  if (!r.ok) throw new Error(`RSS fetch ${r.status}`);
  const xml = await r.text();
  const enc = xml.match(/<enclosure[^>]*\surl=["']([^"']+)["']/i);
  if (!enc) throw new Error('No <enclosure> audio URL found in feed');
  const showTitle = xml.match(/<title>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/title>/i);
  const itemTitle = xml.match(/<item>[\s\S]*?<title>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/title>/i);
  return {
    audioUrl: enc[1],
    title: itemTitle?.[1]?.trim() || null,
    channelName: showTitle?.[1]?.trim() || null,
    thumbnailUrl: null,
  };
}

/** Resolve an Apple Podcasts URL to a downloadable audio URL + metadata. */
export async function resolveAppleEpisode(url: string): Promise<AppleEpisode> {
  const { podcastId, episodeId } = parseAppleUrl(url);
  if (!podcastId && !episodeId) throw new Error('Not a recognizable Apple Podcasts URL');

  if (episodeId) {
    if (!podcastId) throw new Error('episodeId present but podcastId missing from URL');

    // Look up the podcast's episode list (episodeId alone returns 0 results from iTunes)
    const results = await itunesPodcastLookup(podcastId);
    const episodeIdNum = parseInt(episodeId, 10);

    // Find the specific episode by its trackId
    const ep = results.find(
      (r) => r.wrapperType === 'podcastEpisode' && r.trackId === episodeIdNum
    );

    if (!ep) {
      throw new Error(
        `Episode ${episodeId} not found in iTunes lookup for podcast ${podcastId}. ` +
          `It may be older than the 200-episode window.`
      );
    }

    const trackName = (ep.trackName as string) || '';
    const collectionName = (ep.collectionName as string) || null;
    const thumbnail = (ep.artworkUrl600 as string) || null;

    // If iTunes directly provides the audio URL, use it (fast path)
    const episodeUrl = ep.episodeUrl as string | undefined;
    if (episodeUrl) {
      log.info({ episodeId, trackName }, 'resolved via iTunes episodeUrl');
      return {
        audioUrl: episodeUrl,
        title: trackName || null,
        channelName: collectionName,
        thumbnailUrl: thumbnail,
      };
    }

    // iTunes omitted episodeUrl — fall back to matching in the RSS feed
    log.warn({ episodeId, trackName }, 'episodeUrl missing from iTunes, matching in RSS feed');
    const feedUrl = ep.feedUrl as string | undefined;
    if (!feedUrl) throw new Error('No feedUrl in episode record');

    const episodeGuid = ep.episodeGuid as string | undefined;
    const { audioUrl, title } = await findEpisodeInFeed(feedUrl, episodeGuid, trackName);

    return {
      audioUrl,
      title: title || trackName || null,
      channelName: collectionName,
      thumbnailUrl: thumbnail,
    };
  }

  // No episodeId: show link only — return the newest episode from the feed
  const showResults = await itunesPodcastLookup(podcastId!);
  const podcast = showResults.find((r) => r.wrapperType === 'track' && r.feedUrl);
  const feedUrl = podcast?.feedUrl as string | undefined;
  if (!feedUrl) throw new Error('No feedUrl for this podcast');
  return firstEnclosureFromFeed(feedUrl);
}
