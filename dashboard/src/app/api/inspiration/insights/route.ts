import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { embedText } from '@/services/trends/embeddings';
import { searchVec } from '@/services/inspiration/vectorIndex';

const PAGE = 30;       // browse page size
const RANDOM_N = 60;   // random batch size

const baseSelect =
  `SELECT i.id, i.source_id, i.created_at, i.hook, i.idea, i.why_share, i.category, i.resonance, i.status, i.origin,
          c.title AS source_title, c.url AS source_url, c.source_type,
          ch.title AS channel_title, ch.handle AS channel_handle
   FROM insights i
   JOIN content_summaries c ON c.id = i.source_id
   LEFT JOIN channels ch ON ch.id = c.channel_id`;

/** Query: ?status, ?sort=resonance|newest|random, ?q=<semantic>, ?channel, ?category,
 *  ?cursor=<keyset cursor for newest/resonance>. Returns { insights, nextCursor }. */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const status = sp.get('status') || 'visible';
  const sort = sp.get('sort') || 'resonance';
  const q = sp.get('q')?.trim();
  const channel = sp.get('channel');
  const category = sp.get('category');
  const theme = sp.get('theme');
  const cursor = sp.get('cursor');
  const db = getDb();

  // shared filters
  const conds: string[] = [];
  const params: unknown[] = [];
  if (status === 'saved') conds.push("i.status = 'saved'");
  else if (status === 'new') conds.push("i.status = 'new'");
  else if (status === 'hidden') conds.push("i.status = 'hidden'");
  else conds.push("i.status != 'hidden'");
  if (channel) { conds.push('c.channel_id = ?'); params.push(Number(channel)); }
  if (category) { conds.push('i.category = ?'); params.push(category); }
  if (theme) { conds.push('i.id IN (SELECT insight_id FROM insight_themes WHERE theme_id = ?)'); params.push(Number(theme)); }

  // semantic search: sqlite-vec KNN → filter → preserve KNN order
  if (q) {
    const qv = await embedText(q);
    if (!qv) return NextResponse.json({ insights: [], nextCursor: null });
    const ids = searchVec(qv, 200);
    if (!ids.length) return NextResponse.json({ insights: [], nextCursor: null });
    const where = ['i.id IN (' + ids.join(',') + ')', ...conds].join(' AND ');
    const rows = db.prepare(`${baseSelect} WHERE ${where}`).all(...params) as Array<Record<string, unknown>>;
    const order = new Map(ids.map((id, idx) => [id, idx]));
    rows.sort((a, b) => (order.get(a.id as number)! - order.get(b.id as number)!));
    return NextResponse.json({ insights: rows.slice(0, 100), nextCursor: null });
  }

  // random: fresh batch, no pagination
  if (sort === 'random') {
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const rows = db.prepare(`${baseSelect} ${where} ORDER BY RANDOM() LIMIT ${RANDOM_N}`).all(...params);
    return NextResponse.json({ insights: rows, nextCursor: null });
  }

  // browse with keyset pagination (newest | resonance)
  const pageConds = [...conds];
  const pageParams = [...params];
  if (cursor) {
    const [cv, cid] = cursor.split('|');
    if (sort === 'newest') { pageConds.push('(i.created_at < ? OR (i.created_at = ? AND i.id < ?))'); pageParams.push(cv, cv, Number(cid)); }
    else { pageConds.push('(COALESCE(i.resonance,-1) < ? OR (COALESCE(i.resonance,-1) = ? AND i.id < ?))'); pageParams.push(Number(cv), Number(cv), Number(cid)); }
  }
  const orderBy = sort === 'newest' ? 'i.created_at DESC, i.id DESC' : 'COALESCE(i.resonance,-1) DESC, i.id DESC';
  const where = pageConds.length ? 'WHERE ' + pageConds.join(' AND ') : '';
  const rows = db.prepare(`${baseSelect} ${where} ORDER BY ${orderBy} LIMIT ${PAGE + 1}`).all(...pageParams) as Array<Record<string, unknown>>;

  let nextCursor: string | null = null;
  if (rows.length > PAGE) {
    const last = rows[PAGE - 1];
    nextCursor = sort === 'newest' ? `${last.created_at}|${last.id}` : `${last.resonance ?? -1}|${last.id}`;
  }
  return NextResponse.json({ insights: rows.slice(0, PAGE), nextCursor });
}
