import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

/** Mark/unmark a post as 👍 想留. A 👍 post is embedded (if not already) so it joins
 *  the interest profile used to score similar posts. Body: { interested: boolean } */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const postId = parseInt(id, 10);
  if (isNaN(postId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const interested = body.interested ? 1 : 0;

  const db = getDb();
  const post = db.prepare('SELECT id, text, embedding FROM trend_posts WHERE id = ?').get(postId) as
    { id: number; text: string; embedding: string | null } | undefined;
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 });

  db.prepare('UPDATE trend_posts SET interested = ? WHERE id = ?').run(interested, postId);

  // Ensure 👍 posts have an embedding so they can anchor the interest profile.
  if (interested && !post.embedding) {
    const { embedText } = await import('@/services/trends/embeddings');
    const vec = await embedText(post.text);
    if (vec) db.prepare('UPDATE trend_posts SET embedding = ? WHERE id = ?').run(JSON.stringify(vec), postId);
  }

  const likedCount = (db.prepare('SELECT count(*) c FROM trend_posts WHERE interested = 1').get() as { c: number }).c;
  return NextResponse.json({ ok: true, interested: !!interested, likedCount });
}
