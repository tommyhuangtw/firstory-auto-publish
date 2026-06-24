import { config } from 'dotenv';
import path from 'path';
config({ path: path.join(process.cwd(), '.env.local') });
import { getDb } from '../src/db';
import { parseEmbedding } from '../src/services/trends/embeddings';
import { upsertVec } from '../src/services/inspiration/vectorIndex';

(async () => {
  const db = getDb();
  const rows = db.prepare('SELECT id, embedding FROM insights WHERE embedding IS NOT NULL').all() as Array<{ id: number; embedding: string }>;
  let done = 0;
  for (const r of rows) {
    const v = parseEmbedding(r.embedding);
    if (v) { upsertVec(r.id, v); done++; }
  }
  const count = (db.prepare('SELECT COUNT(*) c FROM vec_insights').get() as { c: number }).c;
  console.log('backfilled vectors:', done, '| vec_insights rows:', count);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
