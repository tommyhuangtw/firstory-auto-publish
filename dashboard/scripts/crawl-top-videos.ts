import { config } from 'dotenv';
import path from 'path';
config({ path: path.join(process.cwd(), '.env.local') });
import { fetchWithKeyRotation } from '../src/lib/youtubeKeys';
import { resolveChannel, addChannel } from '../src/services/inspiration/channelCrawler';
import { createSourceRow, runIngest } from '../src/services/inspiration/pipeline';
import { getDb } from '../src/db';

const HANDLES = ['@starterstory', '@ycombinator'];
const LIMIT = 20;
const PUBLISHED_AFTER = '2023-06-25T00:00:00Z'; // past 3 years

async function topVideos(channelId: string, limit: number) {
  const resp = await fetchWithKeyRotation(
    (k) => `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&order=viewCount&publishedAfter=${PUBLISHED_AFTER}&maxResults=${limit}&key=${k}`,
    `search-top:${channelId}`);
  const data = await resp.json();
  return (data.items || []).map((it: any) => ({ videoId: it.id.videoId, title: it.snippet.title })).filter((v: any) => v.videoId);
}

(async () => {
  const db = getDb();
  for (const h of HANDLES) {
    const c = await resolveChannel(h);
    addChannel(c, LIMIT);
    const chRow = db.prepare('SELECT id FROM channels WHERE channel_id = ?').get(c.channelId) as { id: number };
    const vids = await topVideos(c.channelId, LIMIT);
    console.log(`\n=== ${c.title}: top ${vids.length} by views ===`);
    let ingested = 0, skipped = 0;
    for (const v of vids) {
      const exists = db.prepare('SELECT 1 FROM content_summaries WHERE external_id = ?').get(v.videoId);
      if (exists) { skipped++; continue; }
      const input = { url: `https://www.youtube.com/watch?v=${v.videoId}`, title: v.title, channelId: chRow.id, externalId: v.videoId };
      const id = createSourceRow(input);
      try { await runIngest(id, input); ingested++; console.log(`  ✓ ${v.title.slice(0,50)}`); }
      catch (e) { console.warn(`  ✗ ${v.title.slice(0,40)} — ${(e as Error).message}`); }
    }
    console.log(`  → ingested ${ingested}, skipped ${skipped}`);
  }
  console.log('\nDONE. total insights:', (db.prepare('SELECT COUNT(*) c FROM insights').get() as any).c);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
