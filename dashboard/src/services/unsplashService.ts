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

/**
 * Find one tasteful landscape photo for a search query.
 * Returns null when no key is configured or nothing matches — the caller
 * degrades gracefully (image markers are simply dropped, the essay still ships).
 * Triggers Unsplash's download endpoint per their API guidelines.
 */
export async function findImage(query: string): Promise<UnsplashImage | null> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) {
    log.warn('UNSPLASH_ACCESS_KEY not set — skipping image');
    return null;
  }
  try {
    const url = `${API}/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape&content_filter=high`;
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}` } });
    if (!res.ok) {
      log.warn({ status: res.status, query }, 'Unsplash search failed');
      return null;
    }
    const data = (await res.json()) as { results?: UnsplashPhoto[] };
    const photo = data?.results?.[0];
    if (!photo || !photo.urls?.regular) {
      log.info({ query }, 'No Unsplash result');
      return null;
    }

    // ToS: trigger a download event when a photo is used (fire-and-forget).
    const dl = photo.links?.download_location;
    if (dl) {
      fetch(dl, { headers: { Authorization: `Client-ID ${key}` } }).catch(() => {});
    }

    const profile = photo.user?.links?.html ?? 'https://unsplash.com';
    const page = photo.links?.html ?? 'https://unsplash.com';
    return {
      url: photo.urls.regular,
      alt: photo.alt_description ?? photo.description ?? query,
      photographer: photo.user?.name ?? 'Unsplash',
      photographerUrl: `${profile}?${UTM}`,
      photoUrl: `${page}?${UTM}`,
    };
  } catch (err) {
    log.warn({ error: (err as Error).message, query }, 'Unsplash request errored');
    return null;
  }
}
