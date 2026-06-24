import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { embedText, parseEmbedding, cosine } from '@/services/trends/embeddings';

/** Query: ?status=new|saved|hidden|visible (default visible=exclude hidden), ?sort=resonance|newest, ?q=<semantic search>, ?limit */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get('status') || 'visible';
  const sort = searchParams.get('sort') || 'resonance';
  const q = searchParams.get('q')?.trim();
  const limit = parseInt(searchParams.get('limit') || '100', 10);
  const db = getDb();

  let where = '';
  if (status === 'saved') where = "WHERE i.status = 'saved'";
  else if (status === 'new') where = "WHERE i.status = 'new'";
  else if (status === 'hidden') where = "WHERE i.status = 'hidden'";
  else where = "WHERE i.status != 'hidden'";

  const rows = db.prepare(
    `SELECT i.*, c.title AS source_title, c.url AS source_url, c.source_type
     FROM insights i JOIN content_summaries c ON c.id = i.source_id
     ${where} ORDER BY i.created_at DESC LIMIT 500`,
  ).all() as Array<Record<string, unknown>>;

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
