/**
 * Voice corpus embeddings — backfill vectors for posts + stories so the writer
 * can pick relevant examples/stories by similarity. In-memory cosine over a few
 * hundred rows is plenty fast (no vec0 needed). Stored as JSON in a TEXT column,
 * matching the inspiration/themeService pattern.
 */

import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { embedTexts } from '@/services/trends/embeddings';

const log = createChildLogger('voice:embeddings');
const BATCH = 100;

/** Embed any posts/stories missing an embedding. Idempotent. */
export async function backfillEmbeddings(): Promise<{ posts: number; stories: number }> {
  const db = getDb();
  let posts = 0, stories = 0;

  const postRows = db.prepare(
    `SELECT post_id, text FROM threads_posts WHERE is_repost = 0 AND length(text) > 0 AND embedding IS NULL`,
  ).all() as { post_id: string; text: string }[];
  for (let i = 0; i < postRows.length; i += BATCH) {
    const chunk = postRows.slice(i, i + BATCH);
    const vecs = await embedTexts(chunk.map((r) => r.text));
    const upd = db.prepare('UPDATE threads_posts SET embedding = ? WHERE post_id = ?');
    chunk.forEach((r, j) => { if (vecs[j]) { upd.run(JSON.stringify(vecs[j]), r.post_id); posts++; } });
  }

  const storyRows = db.prepare(
    `SELECT id, content FROM voice_assets WHERE type = 'story' AND embedding IS NULL`,
  ).all() as { id: number; content: string }[];
  for (let i = 0; i < storyRows.length; i += BATCH) {
    const chunk = storyRows.slice(i, i + BATCH);
    const vecs = await embedTexts(chunk.map((r) => r.content));
    const upd = db.prepare('UPDATE voice_assets SET embedding = ? WHERE id = ?');
    chunk.forEach((r, j) => { if (vecs[j]) { upd.run(JSON.stringify(vecs[j]), r.id); stories++; } });
  }

  log.info({ posts, stories }, 'Embeddings backfilled');
  return { posts, stories };
}
