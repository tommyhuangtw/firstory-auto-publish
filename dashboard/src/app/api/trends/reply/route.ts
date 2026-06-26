import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { generateNicheReply } from '@/services/trends/nicheReply';

interface PostRow { id: number; author: string | null; text: string }

/** Generate (and store) a reply draft for one niche post. Body: { id }. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  const post = db.prepare('SELECT id, author, text FROM trend_posts WHERE id = ?').get(id) as PostRow | undefined;
  if (!post) return NextResponse.json({ error: 'post not found' }, { status: 404 });

  try {
    const reply = await generateNicheReply({ author: post.author, text: post.text });
    db.prepare('UPDATE trend_posts SET reply_draft = ? WHERE id = ?').run(reply, id);
    return NextResponse.json({ reply_draft: reply });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
