import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('unsplashService');

const API = 'https://api.unsplash.com';
const UTM = 'utm_source=ai_lanrenbao&utm_medium=referral';

export interface UnsplashImage {
  url: string; // regular-size image URL (good for newsletter width)
  alt: string;
  photographer: string;
  photographerUrl: string; // photographer profile (with required UTM)
  photoUrl: string; // photo page on Unsplash (with required UTM)
}

interface UnsplashPhoto {
  alt_description?: string | null;
  description?: string | null;
  urls?: { regular?: string; full?: string };
  links?: { html?: string; download_location?: string };
  user?: { name?: string; links?: { html?: string } };
}

const PER_PAGE = 10;

/**
 * Find the Nth tasteful landscape photo for a search query (0-based index).
 * Lets callers cycle through candidates ("換一張"). Pages automatically:
 * index 0–9 = page 1, 10–19 = page 2, etc.
 * Returns null when no key is configured or nothing matches — the caller
 * degrades gracefully. Triggers Unsplash's download endpoint per their guidelines.
 */
export async function findImageCandidate(query: string, index = 0): Promise<UnsplashImage | null> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) {
    log.warn('UNSPLASH_ACCESS_KEY not set — skipping image');
    return null;
  }
  try {
    const page = Math.floor(index / PER_PAGE) + 1;
    const offset = index % PER_PAGE;
    const url = `${API}/search/photos?query=${encodeURIComponent(query)}&per_page=${PER_PAGE}&page=${page}&orientation=landscape&content_filter=high`;
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}` } });
    if (!res.ok) {
      log.warn({ status: res.status, query }, 'Unsplash search failed');
      return null;
    }
    const data = (await res.json()) as { results?: UnsplashPhoto[] };
    const results = data?.results ?? [];
    // If this page is short (ran out of fresh results), wrap to the first result.
    const photo = results[offset] ?? results[0];
    if (!photo || !photo.urls?.regular) {
      log.info({ query, index }, 'No Unsplash result');
      return null;
    }

    // ToS: trigger a download event when a photo is used (fire-and-forget).
    const dl = photo.links?.download_location;
    if (dl) {
      fetch(dl, { headers: { Authorization: `Client-ID ${key}` } }).catch(() => {});
    }

    const profile = photo.user?.links?.html ?? 'https://unsplash.com';
    const photoPage = photo.links?.html ?? 'https://unsplash.com';
    return {
      url: photo.urls.regular,
      alt: photo.alt_description ?? photo.description ?? query,
      photographer: photo.user?.name ?? 'Unsplash',
      photographerUrl: `${profile}?${UTM}`,
      photoUrl: `${photoPage}?${UTM}`,
    };
  } catch (err) {
    log.warn({ error: (err as Error).message, query }, 'Unsplash request errored');
    return null;
  }
}

/** Convenience: the top (first) photo for a query. */
export function findImage(query: string): Promise<UnsplashImage | null> {
  return findImageCandidate(query, 0);
}
