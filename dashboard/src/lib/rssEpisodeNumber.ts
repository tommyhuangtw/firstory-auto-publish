/**
 * Determine the next episode number at publish time.
 *
 * Strategy:
 * 1. Fetch SoundOn RSS feed → extract latest EP number → +1
 * 2. Fallback: SELECT MAX(episode_number) FROM episodes → +1
 * 3. Throw if both fail
 */

import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('rssEpisodeNumber');

const PODCAST_ID = 'ca974d36-6fcc-46fc-a339-ba7ed8902c80';
const RSS_URL = `https://feeds.soundon.fm/podcasts/${PODCAST_ID}.xml`;

export async function getNextEpisodeNumber(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: { prepare: (sql: string) => { get: (...args: any[]) => unknown } }
): Promise<number> {
  // 1. Try SoundOn RSS
  try {
    const res = await fetch(RSS_URL, { cache: 'no-store' });
    if (res.ok) {
      const xml = await res.text();
      const match = xml.match(/<item>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>/);
      if (match) {
        const epMatch = match[1].match(/EP\s*(\d+)/i);
        if (epMatch) {
          const next = parseInt(epMatch[1]) + 1;
          log.info({ next, source: 'rss' }, 'Next episode number from RSS');
          return next;
        }
      }
    }
  } catch (error) {
    log.warn({ error: (error as Error).message }, 'RSS fetch failed, trying DB fallback');
  }

  // 2. Fallback: DB max
  try {
    const row = db.prepare('SELECT MAX(episode_number) as max_ep FROM episodes')
      .get() as { max_ep: number | null } | undefined;
    if (row?.max_ep != null) {
      const next = row.max_ep + 1;
      log.info({ next, source: 'db' }, 'Next episode number from DB fallback');
      return next;
    }
  } catch (error) {
    log.error({ error: (error as Error).message }, 'DB fallback also failed');
  }

  throw new Error('Cannot determine next episode number: RSS and DB both failed');
}
