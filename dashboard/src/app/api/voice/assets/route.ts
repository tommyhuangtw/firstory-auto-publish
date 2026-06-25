import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

/** List voice assets. ?type=bio|style|story  ?includeHidden=1 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  const includeHidden = searchParams.get('includeHidden') === '1';

  const clauses: string[] = [];
  const params: string[] = [];
  if (type) { clauses.push('type = ?'); params.push(type); }
  if (!includeHidden) clauses.push("status != 'hidden'");
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const assets = getDb().prepare(`
    SELECT id, type, content, topic_tags, source_post_id, pinned, status, updated_at
    FROM voice_assets ${where}
    ORDER BY pinned DESC, id DESC
  `).all(...params);

  return NextResponse.json({ assets });
}
