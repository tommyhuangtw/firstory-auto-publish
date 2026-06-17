import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

/** Mark a post 👍 想留 (1) / 👎 不要 (-1) / clear (0). Marked posts (either sign) are
 *  embedded if needed so they can anchor the interest profile used to score/rank similar
 *  posts. Body: { value: 1 | -1 | 0 } (legacy: { interested: boolean }). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const postId = parseInt(id, 10);
  if (isNaN(postId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  // Tri-state value; fall back to legacy boolean `interested`.
  let value = typeof body.value === 'number' ? body.value : (body.interested ? 1 : 0);
  value = value > 0 ? 1 : value < 0 ? -1 : 0;

  const db = getDb();
  const post = db.prepare('SELECT id, text, embedding FROM trend_posts WHERE id = ?').get(postId) as
    { id: number; text: string; embedding: string | null } | undefined;
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 });

  db.prepare('UPDATE trend_posts SET interested = ? WHERE id = ?').run(value, postId);

  // Ensure marked posts (👍 or 👎) have an embedding so they can anchor the profile.
  if (value !== 0 && !post.embedding) {
    const { embedText } = await import('@/services/trends/embeddings');
    const vec = await embedText(post.text);
    if (vec) db.prepare('UPDATE trend_posts SET embedding = ? WHERE id = ?').run(JSON.stringify(vec), postId);
  }

  const counts = db.prepare(
    "SELECT sum(interested = 1) liked, sum(interested = -1) disliked FROM trend_posts",
  ).get() as { liked: number | null; disliked: number | null };
  return NextResponse.json({ ok: true, value, likedCount: counts.liked || 0, dislikedCount: counts.disliked || 0 });
}
