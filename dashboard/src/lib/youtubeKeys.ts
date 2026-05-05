/**
 * YouTube API key rotation.
 *
 * Cycles through multiple API keys when a request fails with 403 (quota exceeded).
 * Keys are read from YOUTUBE_API_KEYS (comma-separated) with YOUTUBE_API_KEY as fallback.
 */

import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('youtube-keys');

let keys: string[] = [];
let currentIndex = 0;

function loadKeys(): string[] {
  if (keys.length > 0) return keys;

  const multi = process.env.YOUTUBE_API_KEYS;
  if (multi) {
    keys = multi.split(',').map((k) => k.trim()).filter(Boolean);
  }
  if (keys.length === 0) {
    const single = process.env.YOUTUBE_API_KEY;
    if (single) keys = [single];
  }

  log.info({ count: keys.length }, 'YouTube API keys loaded');
  return keys;
}

/** Get the current API key. Returns empty string if none configured. */
export function getYouTubeApiKey(): string {
  const k = loadKeys();
  if (k.length === 0) return '';
  return k[currentIndex % k.length];
}

/** Rotate to the next API key. Returns true if a different key is available. */
export function rotateYouTubeApiKey(): boolean {
  const k = loadKeys();
  if (k.length <= 1) return false;
  const prev = currentIndex;
  currentIndex = (currentIndex + 1) % k.length;
  log.warn({ from: prev + 1, to: currentIndex + 1, total: k.length }, 'Rotated YouTube API key');
  return true;
}

/**
 * Fetch wrapper that auto-rotates API key on 403/429.
 * Tries each key once, throws if all keys fail.
 */
export async function fetchWithKeyRotation(
  buildUrl: (apiKey: string) => string,
  label: string,
): Promise<Response> {
  const k = loadKeys();
  if (k.length === 0) throw new Error('No YouTube API keys configured');

  const startIndex = currentIndex;
  for (let attempt = 0; attempt < k.length; attempt++) {
    const key = k[(startIndex + attempt) % k.length];
    const url = buildUrl(key);
    const resp = await fetch(url);

    if (resp.ok) {
      // Update currentIndex to this working key
      currentIndex = (startIndex + attempt) % k.length;
      return resp;
    }

    if (resp.status === 403 || resp.status === 429) {
      const keyNum = ((startIndex + attempt) % k.length) + 1;
      log.warn({ label, status: resp.status, keyNum, totalKeys: k.length }, 'YouTube API key quota exceeded, trying next');
      if (attempt === k.length - 1) {
        // All keys exhausted
        throw new Error(`YouTube ${label} ${resp.status}: all ${k.length} API keys exhausted`);
      }
      continue;
    }

    // Other error — don't rotate, just throw
    const body = await resp.text().catch(() => '');
    throw new Error(`YouTube ${label} ${resp.status}: ${body.slice(0, 200)}`);
  }

  throw new Error(`YouTube ${label}: all ${k.length} API keys exhausted`);
}
