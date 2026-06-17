/**
 * Post embeddings for the 👍 interest-learning loop.
 * Uses OpenAI text-embedding-3-small (cheap, 1536-dim). "Interest" = semantic
 * similarity (cosine) of a post to the set of posts Tommy marked 👍 想留.
 */

import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('trend-embeddings');
const MODEL = 'text-embedding-3-small';

/** Embed a batch of texts in one API call. Returns null for entries on failure. */
export async function embedTexts(texts: string[]): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    log.warn('OPENAI_API_KEY not set — skipping embeddings');
    return texts.map(() => null);
  }
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, input: texts.map((t) => t.slice(0, 6000) || ' ') }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      log.warn({ status: res.status, body: (await res.text()).slice(0, 200) }, 'Embedding API error');
      return texts.map(() => null);
    }
    const data = await res.json() as { data?: Array<{ index: number; embedding: number[] }> };
    const out: (number[] | null)[] = texts.map(() => null);
    for (const item of data.data || []) out[item.index] = item.embedding;
    return out;
  } catch (e) {
    log.warn({ err: (e as Error).message }, 'Embedding failed');
    return texts.map(() => null);
  }
}

export async function embedText(text: string): Promise<number[] | null> {
  return (await embedTexts([text]))[0];
}

/** Cosine similarity of two vectors (handles non-normalized just in case). */
export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Interest score 0..1 = mean of the top-k cosine sims to the 👍 set (k-NN, one-class). */
export function interestScore(vec: number[], likedVecs: number[][], k = 3): number {
  if (!likedVecs.length || !vec.length) return 0;
  const sims = likedVecs.map((lv) => cosine(vec, lv)).sort((a, b) => b - a);
  const top = sims.slice(0, Math.min(k, sims.length));
  return top.reduce((s, x) => s + x, 0) / top.length;
}

/** Parse a stored embedding (JSON string) back to a vector, or null. */
export function parseEmbedding(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.length ? v as number[] : null;
  } catch { return null; }
}
