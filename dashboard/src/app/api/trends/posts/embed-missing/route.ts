import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

/** Backfill embeddings for posts that don't have one yet, capped per call (loop until
 *  remaining=0). Default scope = recent posts; ?all=1 includes the old seed_csv labeling
 *  pool (which has old scraped_at dates and is otherwise skipped). */
export async function POST(request: NextRequest) {
  const db = getDb();
  const all = request.nextUrl.searchParams.get('all') === '1';
  const where = all ? 'embedding IS NULL' : "embedding IS NULL AND scraped_at > datetime('now','-7 days')";
  const rows = db.prepare(
    `SELECT id, text FROM trend_posts WHERE ${where} ORDER BY id DESC LIMIT 256`,
  ).all() as Array<{ id: number; text: string }>;
  if (rows.length === 0) return NextResponse.json({ embedded: 0, remaining: 0 });

  const { embedTexts } = await import('@/services/trends/embeddings');
  const vecs = await embedTexts(rows.map((r) => r.text));
  const upd = db.prepare('UPDATE trend_posts SET embedding = ? WHERE id = ?');
  let n = 0;
  rows.forEach((r, i) => { if (vecs[i]) { upd.run(JSON.stringify(vecs[i]), r.id); n++; } });

  const remaining = (db.prepare(`SELECT count(*) c FROM trend_posts WHERE ${where}`).get() as { c: number }).c;
  return NextResponse.json({ embedded: n, remaining });
}
