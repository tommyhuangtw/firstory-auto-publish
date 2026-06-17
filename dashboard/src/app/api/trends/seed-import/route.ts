import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { getDb } from '@/db';
import { isAIRelevant } from '@/services/trends/scorer';

/**
 * One-time import of a scraped-posts CSV (from the old Supabase project) into trend_posts
 * as a `source='seed_csv'` labeling pool — the cold-start corpus for the 👍/👎 interest
 * profile. Only posts with engagement (讚+留言) ≥ minEng are kept (the rest aren't worth
 * filtering). scraped_at is set to the original post date so these never show up in the
 * ≤2-day hot-post list — they exist purely to be labeled and anchor the profile.
 *
 * Embeddings are NOT computed here (keeps the request fast); call embed-missing?all=1 after.
 * Body: { path?, minEng? } — path defaults to the repo-root CSV, minEng defaults to 50.
 */
const DEFAULT_CSV = 'public_posts_raw_rows_threadify.csv';

/** Minimal RFC-4180 CSV parser (handles quoted fields, embedded commas/newlines, "" escapes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip, \n handles row end */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const toInt = (v: string) => { const n = parseInt((v || '').replace(/[^0-9-]/g, ''), 10); return isNaN(n) ? 0 : n; };

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const minEng = typeof body.minEng === 'number' ? body.minEng : 50;
  const csvPath = body.path || path.resolve(process.cwd(), '..', DEFAULT_CSV);

  let raw: string;
  try {
    raw = await readFile(csvPath, 'utf8');
  } catch {
    return NextResponse.json({ error: `CSV not found at ${csvPath}` }, { status: 400 });
  }

  const rows = parseCsv(raw);
  if (rows.length < 2) return NextResponse.json({ error: 'CSV empty or unparseable' }, { status: 400 });
  const header = rows[0].map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const ci = {
    text: col('content_text'), user: col('threads_username'), likes: col('like_count'),
    replies: col('reply_count'), posted: col('posted_at'), url: col('threads_post_url'),
  };
  if (ci.text < 0) return NextResponse.json({ error: 'CSV missing content_text column' }, { status: 400 });

  const db = getDb();
  const existing = new Set(
    (db.prepare("SELECT permalink FROM trend_posts WHERE permalink IS NOT NULL").all() as Array<{ permalink: string }>)
      .map((r) => r.permalink),
  );

  const insert = db.prepare(`
    INSERT INTO trend_posts (source, author, text, like_count, reply_count, velocity, posted_at, permalink, relevant, interested, scraped_at)
    VALUES ('seed_csv', ?, ?, ?, ?, 0, ?, ?, ?, 0, ?)
  `);

  let imported = 0, skipped = 0;
  const tx = db.transaction(() => {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const text = (r[ci.text] || '').trim();
      const url = ci.url >= 0 ? (r[ci.url] || '').trim() : '';
      const likes = ci.likes >= 0 ? toInt(r[ci.likes]) : 0;
      const replies = ci.replies >= 0 ? toInt(r[ci.replies]) : 0;
      if (!text || likes + replies < minEng || (url && existing.has(url))) { skipped++; continue; }
      if (url) existing.add(url);
      const posted = ci.posted >= 0 ? (r[ci.posted] || '').trim() : '';
      insert.run(
        ci.user >= 0 ? (r[ci.user] || '').trim() : null,
        text, likes, replies,
        posted || null, url || null,
        isAIRelevant(text) ? 1 : 0,
        posted || null,
      );
      imported++;
    }
  });
  tx();

  const totalSeed = (db.prepare("SELECT count(*) c FROM trend_posts WHERE source = 'seed_csv'").get() as { c: number }).c;
  const unembedded = (db.prepare("SELECT count(*) c FROM trend_posts WHERE source = 'seed_csv' AND embedding IS NULL").get() as { c: number }).c;
  return NextResponse.json({ imported, skipped, totalSeed, unembedded, minEng });
}
