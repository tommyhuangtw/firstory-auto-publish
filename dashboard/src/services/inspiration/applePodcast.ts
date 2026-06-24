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

async function itunesLookup(id: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`https://itunes.apple.com/lookup?id=${id}&entity=podcastEpisode`);
  if (!r.ok) throw new Error(`iTunes lookup ${r.status}`);
  const data = await r.json();
  return (data?.results || []) as Record<string, unknown>[];
}

/** First <enclosure url="…"> in an RSS feed (newest episode), with show title. */
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
    const results = await itunesLookup(episodeId);
    const ep = results.find((r) => r.wrapperType === 'podcastEpisode') || results[0];
    const audioUrl = ep?.episodeUrl as string | undefined;
    if (audioUrl) {
      return {
        audioUrl,
        title: (ep?.trackName as string) || null,
        channelName: (ep?.collectionName as string) || null,
        thumbnailUrl: (ep?.artworkUrl600 as string) || null,
      };
    }
    log.warn({ episodeId }, 'episodeUrl missing from iTunes lookup, falling back to feed');
  }

  // Fall back: look up the show, read its RSS feed, take newest enclosure.
  const showResults = await itunesLookup(podcastId!);
  const feedUrl = showResults.find((r) => r.feedUrl)?.feedUrl as string | undefined;
  if (!feedUrl) throw new Error('No feedUrl for this podcast');
  return firstEnclosureFromFeed(feedUrl);
}
