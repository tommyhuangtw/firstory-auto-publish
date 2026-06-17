import { NextResponse } from 'next/server';
import { getDb } from '@/db';

/** Backfill embeddings for recent posts that don't have one yet (e.g. scraped before
 *  the interest feature existed). Capped per call. */
export async function POST() {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, text FROM trend_posts WHERE embedding IS NULL AND scraped_at > datetime('now','-7 days') ORDER BY id DESC LIMIT 256",
  ).all() as Array<{ id: number; text: string }>;
  if (rows.length === 0) return NextResponse.json({ embedded: 0, remaining: 0 });

  const { embedTexts } = await import('@/services/trends/embeddings');
  const vecs = await embedTexts(rows.map((r) => r.text));
  const upd = db.prepare('UPDATE trend_posts SET embedding = ? WHERE id = ?');
  let n = 0;
  rows.forEach((r, i) => { if (vecs[i]) { upd.run(JSON.stringify(vecs[i]), r.id); n++; } });

  const remaining = (db.prepare(
    "SELECT count(*) c FROM trend_posts WHERE embedding IS NULL AND scraped_at > datetime('now','-7 days')",
  ).get() as { c: number }).c;
  return NextResponse.json({ embedded: n, remaining });
}
