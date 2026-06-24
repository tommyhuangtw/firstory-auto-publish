import { config } from 'dotenv';
import path from 'path';
config({ path: path.join(process.cwd(), '.env.local') });
import { getDb } from '../src/db';
import { decodeHtmlEntities, fetchYouTubeVideoMeta } from '../src/services/inspiration/sources';

function ytId(url: string): string | null {
  const m = url?.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([\w-]{11})/);
  return m?.[1] || null;
}

(async () => {
  const db = getDb();

  // 1. Decode HTML entities in stored transcripts.
  const rows = db.prepare("SELECT id, transcript FROM content_summaries WHERE transcript LIKE '%&%'").all() as Array<{ id: number; transcript: string }>;
  const upd = db.prepare('UPDATE content_summaries SET transcript = ? WHERE id = ?');
  let decoded = 0;
  for (const r of rows) {
    const d = decodeHtmlEntities(r.transcript);
    if (d !== r.transcript) { upd.run(d, r.id); decoded++; }
  }
  console.log('decoded transcripts:', decoded);

  // 2. Backfill title/channel/thumbnail for YouTube sources missing a title.
  const missing = db.prepare("SELECT id, url FROM content_summaries WHERE source_type='youtube' AND (title IS NULL OR title='')").all() as Array<{ id: number; url: string }>;
  let titled = 0;
  for (const r of missing) {
    const vid = ytId(r.url);
    if (!vid) continue;
    const meta = await fetchYouTubeVideoMeta(vid);
    if (meta.title) {
      db.prepare('UPDATE content_summaries SET title = ?, channel_name = COALESCE(channel_name, ?), thumbnail_url = COALESCE(thumbnail_url, ?) WHERE id = ?')
        .run(meta.title, meta.channelName, meta.thumbnailUrl, r.id);
      titled++;
      console.log(' titled:', r.id, '·', meta.title.slice(0, 50), '·', meta.channelName);
    }
  }
  console.log('backfilled titles:', titled);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
