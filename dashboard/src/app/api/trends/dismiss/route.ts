import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

/**
 * Mark a trend post as seen/removed (or undo). Shared by 回覆專區 + 熱點 (swipe-left / ✕).
 * Body: { id: number, dismissed?: boolean }  (dismissed defaults to true)
 * Dismissed posts drop out of /api/trends/niche and /api/trends/posts.
 */
export async function POST(req: NextRequest) {
  const { id, dismissed = true } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });
  getDb().prepare('UPDATE trend_posts SET dismissed = ? WHERE id = ?').run(dismissed ? 1 : 0, id);
  return NextResponse.json({ ok: true, id, dismissed: !!dismissed });
}
