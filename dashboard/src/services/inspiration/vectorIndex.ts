import { getDb } from '@/db';

/** Pack a number[] into a Float32 buffer for vec_f32(). */
export function f32(a: number[]): Buffer {
  return Buffer.from(new Float32Array(a).buffer);
}

/** Insert-or-replace an insight's vector. rowid = insight id (bound as BigInt). */
export function upsertVec(insightId: number, vec: number[]): void {
  const db = getDb();
  const id = BigInt(insightId);
  db.prepare('DELETE FROM vec_insights WHERE rowid = ?').run(id);   // idempotent
  db.prepare('INSERT INTO vec_insights(rowid, embedding) VALUES (?, vec_f32(?))').run(id, f32(vec));
}

export function removeVec(insightId: number): void {
  getDb().prepare('DELETE FROM vec_insights WHERE rowid = ?').run(BigInt(insightId));
}

/** KNN search → insight ids ordered by similarity (closest first). */
export function searchVec(queryVec: number[], k = 200): number[] {
  const limit = Math.max(1, Math.min(500, Math.floor(k)));
  const rows = getDb().prepare(
    `SELECT rowid AS insight_id FROM vec_insights WHERE embedding MATCH vec_f32(?) ORDER BY distance LIMIT ${limit}`,
  ).all(f32(queryVec)) as Array<{ insight_id: number }>;
  return rows.map((r) => r.insight_id);
}
