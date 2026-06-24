import { getDb } from '@/db';
import { interestScore, parseEmbedding } from '@/services/trends/embeddings';

const MIN_PROFILE = 5; // need at least 5 👍 before resonance is meaningful

export interface InterestProfile {
  likedVecs: number[][];
  dislikedVecs: number[][];
  hasProfile: boolean;
}

/** Load the trends 👍/👎 embedding profile (shared with /trends). */
export function loadInterestProfile(): InterestProfile {
  const db = getDb();
  const rows = db.prepare(
    'SELECT interested, embedding FROM trend_posts WHERE interested != 0 AND embedding IS NOT NULL',
  ).all() as Array<{ interested: number; embedding: string }>;
  const likedVecs: number[][] = [];
  const dislikedVecs: number[][] = [];
  for (const r of rows) {
    const v = parseEmbedding(r.embedding);
    if (!v) continue;
    (r.interested === 1 ? likedVecs : dislikedVecs).push(v);
  }
  return { likedVecs, dislikedVecs, hasProfile: likedVecs.length >= MIN_PROFILE };
}

/** Score one embedding to 0-100 against the profile, or null when no profile yet. */
export function scoreResonance(vec: number[] | null, profile: InterestProfile): number | null {
  if (!vec || !profile.hasProfile) return null;
  const raw = interestScore(vec, profile.likedVecs, profile.dislikedVecs); // ~[-0.5, 1]
  return Math.round(Math.max(0, Math.min(1, raw)) * 100);
}
