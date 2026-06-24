import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { embedText, parseEmbedding, cosine } from '@/services/trends/embeddings';

/** Query: ?status=new|saved|hidden|visible (default visible=exclude hidden),
 *  ?sort=resonance|newest|random, ?q=<semantic search>, ?channel=<channelId>,
 *  ?category=mindset|tactic|contrarian|story, ?limit */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get('status') || 'visible';
  const sort = searchParams.get('sort') || 'resonance';
  const q = searchParams.get('q')?.trim();
  const channel = searchParams.get('channel');
  const category = searchParams.get('category');
  const limit = parseInt(searchParams.get('limit') || '100', 10);
  const db = getDb();

  const conds: string[] = [];
  const params: unknown[] = [];
  if (status === 'saved') conds.push("i.status = 'saved'");
  else if (status === 'new') conds.push("i.status = 'new'");
  else if (status === 'hidden') conds.push("i.status = 'hidden'");
  else conds.push("i.status != 'hidden'");
  if (channel) { conds.push('c.channel_id = ?'); params.push(Number(channel)); }
  if (category) { conds.push('i.category = ?'); params.push(category); }
  const where = 'WHERE ' + conds.join(' AND ');

  // Random shuffle is applied in SQL; resonance/newest fetch newest-first then (resonance) re-sort in JS.
  const orderBy = sort === 'random' ? 'RANDOM()' : 'i.created_at DESC';

  const rows = db.prepare(
    `SELECT i.*, c.title AS source_title, c.url AS source_url, c.source_type,
            ch.title AS channel_title, ch.handle AS channel_handle
     FROM insights i
     JOIN content_summaries c ON c.id = i.source_id
     LEFT JOIN channels ch ON ch.id = c.channel_id
     ${where} ORDER BY ${orderBy} LIMIT 500`,
  ).all(...params) as Array<Record<string, unknown>>;

  let result = rows;
  if (q) {
    const qv = await embedText(q);
    if (qv) {
      result = rows
        .map((r) => ({ r, sim: (() => { const v = parseEmbedding(r.embedding as string); return v ? cosine(qv, v) : -1; })() }))
        .sort((a, b) => b.sim - a.sim)
        .map((x) => x.r);
    }
  } else if (sort === 'resonance') {
    result = rows.slice().sort((a, b) => (Number(b.resonance ?? -1)) - (Number(a.resonance ?? -1)));
  }

  const insights = result.slice(0, limit).map((r) => { delete r.embedding; return r; });
  return NextResponse.json({ insights, total: insights.length });
}
