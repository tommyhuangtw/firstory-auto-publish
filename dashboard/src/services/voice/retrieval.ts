/**
 * Voice writer retrieval — pick style examples + relevant stories by similarity.
 *
 * Examples: top-by-similarity then re-ranked by engagement ("相似 × 觀眾買單").
 * Stories: similarity-gated so irrelevant anecdotes are never surfaced (can be 0).
 */

import { getDb } from '@/db';
import { embedText, cosine, parseEmbedding } from '@/services/trends/embeddings';

export interface ExamplePost { post_id: string; text: string; engagement_rate: number; sim: number }
export interface StoryMatch { id: number; content: string; topic_tags: string | null; sim: number }

/** Top-k style examples: most similar (top 15) then re-ranked by engagement. */
export async function retrieveExamples(query: string, k = 4): Promise<ExamplePost[]> {
  const qv = await embedText(query);
  if (!qv) return [];
  const rows = getDb().prepare(
    `SELECT post_id, text, engagement_rate, embedding FROM threads_posts
     WHERE is_repost = 0 AND embedding IS NOT NULL`,
  ).all() as { post_id: string; text: string; engagement_rate: number; embedding: string }[];

  const scored = rows
    .map((r) => { const v = parseEmbedding(r.embedding); return v ? { ...r, sim: cosine(qv, v) } : null; })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  scored.sort((a, b) => b.sim - a.sim);
  const pool = scored.slice(0, 15);
  pool.sort((a, b) => b.engagement_rate - a.engagement_rate);
  return pool.slice(0, k).map((r) => ({ post_id: r.post_id, text: r.text, engagement_rate: r.engagement_rate, sim: r.sim }));
}

/** Relevant stories above a similarity threshold (may return []). */
export async function retrieveStories(query: string, threshold = 0.32, k = 3): Promise<StoryMatch[]> {
  const qv = await embedText(query);
  if (!qv) return [];
  const rows = getDb().prepare(
    `SELECT id, content, topic_tags, embedding FROM voice_assets
     WHERE type = 'story' AND status != 'hidden' AND embedding IS NOT NULL`,
  ).all() as { id: number; content: string; topic_tags: string | null; embedding: string }[];

  const scored = rows
    .map((r) => { const v = parseEmbedding(r.embedding); return v ? { ...r, sim: cosine(qv, v) } : null; })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return scored
    .filter((r) => r.sim >= threshold)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, k)
    .map((r) => ({ id: r.id, content: r.content, topic_tags: r.topic_tags, sim: r.sim }));
}
