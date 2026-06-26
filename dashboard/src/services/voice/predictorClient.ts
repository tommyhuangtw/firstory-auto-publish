/**
 * Client for the like-predictor scoring service (Python, stdlib HTTP).
 *
 * The service is OPTIONAL: if it isn't running, scoring is skipped and draft
 * generation proceeds unscored — writing must never be blocked by the predictor.
 *
 * Service: experiments/like-predictor/score_service.py  (default port 8765)
 */
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('voice:predictor');

const BASE_URL = process.env.LIKE_PREDICTOR_URL || 'http://127.0.0.1:8765';
const TIMEOUT_MS = 8000;

export interface DraftScore {
  viralProb: number;        // P(beats author P90) — primary "會不會爆" gauge
  relativeScore: number;    // author-relative engagement, finer ranking signal
  authorMedianLikes: number | null;
  authorP90Likes: number | null;
}

async function postJson(path: string, body: unknown): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      log.warn({ status: resp.status }, 'predictor returned non-200');
      return null;
    }
    return await resp.json();
  } catch (e) {
    log.warn({ err: (e as Error).message }, 'predictor unreachable — skipping scores');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function toScore(raw: Record<string, unknown>): DraftScore {
  return {
    viralProb: Number(raw.viral_prob ?? 0),
    relativeScore: Number(raw.relative_score ?? 0),
    authorMedianLikes: raw.author_median_likes == null ? null : Number(raw.author_median_likes),
    authorP90Likes: raw.author_p90_likes == null ? null : Number(raw.author_p90_likes),
  };
}

/** Score many drafts in one call. Returns null if the service is unavailable. */
export async function scoreDrafts(texts: string[], author?: string): Promise<DraftScore[] | null> {
  if (texts.length === 0) return [];
  const data = (await postJson('/score', { texts, author })) as { results?: Record<string, unknown>[] } | null;
  if (!data?.results) return null;
  return data.results.map(toScore);
}

/** True if the scoring service answers /health. */
export async function predictorHealthy(): Promise<boolean> {
  try {
    const resp = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return resp.ok;
  } catch {
    return false;
  }
}
