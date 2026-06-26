/**
 * One-off backfill: populate content_summaries.published_at (and insights.source_ts)
 * for sources ingested before publish-date capture existed.
 *
 *   YouTube → batch lookup videoIds (50/call) via Data API snippet.publishedAt
 *   Apple   → re-resolve episode pubDate via iTunes/RSS (no audio download)
 *   manual  → skipped (no source date)
 *
 * Usage: npx tsx scripts/backfill-publish-dates.ts
 */

import 'dotenv/config';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../.env'), override: true });
config({ path: resolve(__dirname, '../.env.local'), override: true });

import { getDb, closeDb } from '@/db';
import { fetchWithKeyRotation } from '@/lib/youtubeKeys';
import { resolveAppleEpisode } from '@/services/inspiration/applePodcast';

interface SourceRow { id: number; source_type: string; external_id: string | null; url: string }

/** Persist a publish date to both the source row and its insights' denormalized source_ts. */
function apply(db: ReturnType<typeof getDb>, sourceId: number, publishedAt: string): void {
  db.prepare('UPDATE content_summaries SET published_at = ? WHERE id = ?').run(publishedAt, sourceId);
  db.prepare('UPDATE insights SET source_ts = ? WHERE source_id = ?').run(publishedAt, sourceId);
}

async function backfillYouTube(db: ReturnType<typeof getDb>, rows: SourceRow[]): Promise<{ filled: number; failed: number }> {
  let filled = 0, failed = 0;
  // Batch in groups of 50 (Data API videos endpoint cap).
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const ids = batch.map((r) => r.external_id).filter(Boolean).join(',');
    if (!ids) continue;
    try {
      const resp = await fetchWithKeyRotation(
        (k) => `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids}&key=${k}`,
        `backfill-videos:${i}`,
      );
      const data = await resp.json();
      const dateById = new Map<string, string>();
      for (const it of data.items || []) {
        if (it.id && it.snippet?.publishedAt) dateById.set(it.id, it.snippet.publishedAt);
      }
      for (const r of batch) {
        const d = r.external_id ? dateById.get(r.external_id) : undefined;
        if (d) { apply(db, r.id, d); filled++; } else { failed++; }
      }
    } catch (e) {
      console.error(`  YouTube batch ${i} failed: ${(e as Error).message}`);
      failed += batch.length;
    }
  }
  return { filled, failed };
}

async function backfillApple(db: ReturnType<typeof getDb>, rows: SourceRow[]): Promise<{ filled: number; failed: number }> {
  let filled = 0, failed = 0;
  for (const r of rows) {
    try {
      const ep = await resolveAppleEpisode(r.url);
      if (ep.publishedAt) { apply(db, r.id, ep.publishedAt); filled++; } else { failed++; }
    } catch (e) {
      console.error(`  Apple source ${r.id} failed: ${(e as Error).message}`);
      failed++;
    }
  }
  return { filled, failed };
}

async function main() {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, source_type, external_id, url FROM content_summaries
     WHERE published_at IS NULL AND source_type IN ('youtube', 'apple_podcast')`,
  ).all() as SourceRow[];

  const yt = rows.filter((r) => r.source_type === 'youtube' && r.external_id);
  const apple = rows.filter((r) => r.source_type === 'apple_podcast');
  console.log(`Backfilling: ${yt.length} YouTube + ${apple.length} Apple sources missing published_at\n`);

  const ytRes = await backfillYouTube(db, yt);
  console.log(`YouTube: ${ytRes.filled} filled, ${ytRes.failed} unresolved`);
  const appleRes = await backfillApple(db, apple);
  console.log(`Apple:   ${appleRes.filled} filled, ${appleRes.failed} unresolved`);

  const remaining = db.prepare("SELECT COUNT(*) AS n FROM content_summaries WHERE published_at IS NULL AND source_type != 'manual'").get() as { n: number };
  console.log(`\nDone. ${ytRes.filled + appleRes.filled} dates backfilled; ${remaining.n} non-manual sources still without a date.`);
  closeDb();
}

main().catch((e) => { console.error(e); process.exit(1); });
