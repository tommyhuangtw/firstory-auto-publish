# Channel Registry + Incremental Crawl Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register YouTube channels and incrementally crawl their latest N videos into the inspiration library, skipping already-ingested videos, so periodic re-crawls only pick up new uploads.

**Architecture:** A `channels` registry table + two new `content_summaries` columns (`channel_id`, `external_id`) for linkage and dedup. A `channelCrawler` service resolves a handle → uploads playlist (YouTube Data API via the existing `fetchWithKeyRotation` key-rotation helper), lists latest videos, dedups by video id, and feeds new ones through the EXISTING ingest pipeline (`createSourceRow` + `runIngest`). Thin API + a small Channels management page. Crawl is fire-and-forget; the existing per-source status drives UI progress.

**Tech Stack:** Next.js 16.2.4 (App Router), better-sqlite3, YouTube Data API v3 (API key), the existing inspiration ingest pipeline (APIFY transcript → LLM insight extraction → embeddings → sqlite).

**Verification convention (per project CLAUDE.md):** No unit-test framework. Verify with `cd dashboard && npm run build`, `npx tsc --noEmit`, and `npx tsx scripts/<smoke>.ts`. Each task ends with verification + a commit. Commit messages in English, no `Co-Authored-By`.

**Reusable signatures (verbatim — do not re-derive):**

```ts
// src/lib/youtubeKeys.ts
import { fetchWithKeyRotation } from '@/lib/youtubeKeys';
// fetchWithKeyRotation(buildUrl: (apiKey: string) => string, label: string): Promise<Response>
//   tries each key, auto-rotates on 403/429, throws if all exhausted.

// src/services/inspiration/pipeline.ts  (from the inspiration-library feature)
import { createSourceRow, runIngest } from '@/services/inspiration/pipeline';
// createSourceRow(input: IngestInput): number      → inserts a content_summaries row ('processing'), returns id
// runIngest(sourceId: number, input: IngestInput): Promise<{ insightCount: number }>

// src/services/inspiration/types.ts
// IngestInput = { url?, text?, title?, userPoints? }   ← this plan ADDS channelId?, externalId?

import { getDb } from '@/db';        // better-sqlite3 Database
import { createChildLogger } from '@/lib/logger';
```

**Validated Data API shapes (from a live probe of all 5 handles):**
- `GET https://www.googleapis.com/youtube/v3/channels?part=contentDetails,snippet&forHandle={handle}&key={k}` → `items[0].id` (UC…), `items[0].contentDetails.relatedPlaylists.uploads` (UU…), `items[0].snippet.title`, `items[0].snippet.thumbnails.default.url`.
- `GET https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId={uploads}&maxResults={n}&key={k}` → `items[].contentDetails.videoId`, `items[].snippet.title`, `items[].contentDetails.videoPublishedAt`.

---

## File Structure

**New:**
- `src/services/inspiration/channelCrawler.ts` — `resolveChannel`, `listLatestVideos`, `addChannel`, `crawlChannel`, `crawlAllActive`, `seedDefaultChannels`
- `src/app/api/inspiration/channels/route.ts` — GET list, POST add
- `src/app/api/inspiration/channels/[id]/route.ts` — PATCH, DELETE
- `src/app/api/inspiration/channels/[id]/crawl/route.ts` — POST crawl one
- `src/app/api/inspiration/channels/crawl-all/route.ts` — POST crawl all
- `src/app/inspiration/channels/page.tsx` — Channels management UI
- `scripts/seed-channels.ts` — idempotent seed of the 5 channels (committed)

**Modify:**
- `src/db/index.ts` — `channels` table + `safeAlter` 2 columns on `content_summaries` + indexes
- `src/services/inspiration/types.ts` — add `channelId?`, `externalId?` to `IngestInput`
- `src/services/inspiration/pipeline.ts` — `createSourceRow` writes the 2 new columns
- `src/app/inspiration/page.tsx` — header link to `/inspiration/channels`

---

## Task 1: DB — `channels` table + `content_summaries` columns

**Files:** Modify `src/db/index.ts`

- [ ] **Step 1: Add the `channels` table** (next to the `insights`/`insight_drafts` blocks added by the inspiration-library feature)

```ts
_db!.exec(`
  CREATE TABLE IF NOT EXISTS channels (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    platform            TEXT    NOT NULL DEFAULT 'youtube',
    handle              TEXT,
    channel_id          TEXT    UNIQUE,
    uploads_playlist_id TEXT,
    title               TEXT,
    thumbnail_url       TEXT,
    active              INTEGER NOT NULL DEFAULT 1,
    fetch_count         INTEGER NOT NULL DEFAULT 5,
    last_crawled_at     TEXT,
    created_at          TEXT    DEFAULT (datetime('now'))
  )
`);
```

- [ ] **Step 2: Add the 2 dedup/linkage columns + indexes** (near the other `safeAlter`/`safeIndex` calls)

```ts
safeAlter('ALTER TABLE content_summaries ADD COLUMN channel_id INTEGER');
safeAlter('ALTER TABLE content_summaries ADD COLUMN external_id TEXT');
safeIndex('CREATE INDEX IF NOT EXISTS idx_content_summaries_external ON content_summaries(external_id)');
safeIndex('CREATE INDEX IF NOT EXISTS idx_content_summaries_channel ON content_summaries(channel_id)');
```

- [ ] **Step 3: Verify the schema**

Run: `cd dashboard && npx tsx -e "import { getDb } from './src/db'; const db=getDb(); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='channels'\").all()); console.log(db.prepare('PRAGMA table_info(content_summaries)').all().filter(c=>['channel_id','external_id'].includes(c.name)).map(c=>c.name));"`
Expected: prints `[ { name: 'channels' } ]` then `[ 'channel_id', 'external_id' ]`

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/db/index.ts
git commit -m "feat(channels): add channels table + content_summaries dedup columns"
```

---

## Task 2: Extend `IngestInput` + `createSourceRow`

**Files:** Modify `src/services/inspiration/types.ts`, `src/services/inspiration/pipeline.ts`

- [ ] **Step 1: Add optional fields to `IngestInput`**

In `src/services/inspiration/types.ts`, inside the `IngestInput` interface, add:
```ts
  channelId?: number;       // set when ingested via a channel crawl
  externalId?: string;      // YouTube video id (or Apple episode id) — dedup key
```

- [ ] **Step 2: Write the 2 new columns in `createSourceRow`**

In `src/services/inspiration/pipeline.ts`, replace the `createSourceRow` INSERT so it persists the new fields. The function currently is:
```ts
export function createSourceRow(input: IngestInput): number {
  const db = getDb();
  const sourceType = input.text && !input.url ? 'manual'
    : /youtube\.com|youtu\.be/i.test(input.url || '') ? 'youtube'
    : /podcasts\.apple\.com/i.test(input.url || '') ? 'apple_podcast' : 'manual';
  const r = db.prepare(
    `INSERT INTO content_summaries (url, source_type, title, status) VALUES (?, ?, ?, 'processing')`,
  ).run(input.url || '(manual)', sourceType, input.title || null);
  return Number(r.lastInsertRowid);
}
```
Change the INSERT to:
```ts
  const r = db.prepare(
    `INSERT INTO content_summaries (url, source_type, title, status, channel_id, external_id)
     VALUES (?, ?, ?, 'processing', ?, ?)`,
  ).run(input.url || '(manual)', sourceType, input.title || null, input.channelId ?? null, input.externalId ?? null);
```

- [ ] **Step 3: Verify compile**

Run: `cd dashboard && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE 'inspiration/(types|pipeline)' || echo "types+pipeline clean"`
Expected: `types+pipeline clean`

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/services/inspiration/types.ts dashboard/src/services/inspiration/pipeline.ts
git commit -m "feat(channels): thread channelId/externalId through ingest"
```

---

## Task 3: Channel resolution + latest-videos listing

**Files:** Create `src/services/inspiration/channelCrawler.ts`, `scripts/test-channel-resolve.ts`

- [ ] **Step 1: Write the resolver + lister**

Create `src/services/inspiration/channelCrawler.ts`:
```ts
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { fetchWithKeyRotation } from '@/lib/youtubeKeys';

const log = createChildLogger('channel-crawler');

export interface ResolvedChannel {
  channelId: string;
  uploadsPlaylistId: string;
  title: string;
  thumbnailUrl: string | null;
  handle: string;        // normalized with leading '@'
}

export interface ChannelVideo {
  videoId: string;
  title: string;
  publishedAt: string | null;
}

/** Extract a bare handle (no '@') from a channel URL or raw handle. */
export function parseHandle(urlOrHandle: string): string {
  const m = urlOrHandle.match(/@([A-Za-z0-9_.\-]+)/);
  if (m) return m[1];
  return urlOrHandle.replace(/^@/, '').trim();
}

/** Resolve a YouTube channel URL/handle → channelId + uploads playlist + metadata. */
export async function resolveChannel(urlOrHandle: string): Promise<ResolvedChannel> {
  const handle = parseHandle(urlOrHandle);
  if (!handle) throw new Error('Could not parse a channel handle from input');
  const resp = await fetchWithKeyRotation(
    (k) => `https://www.googleapis.com/youtube/v3/channels?part=contentDetails,snippet&forHandle=${encodeURIComponent(handle)}&key=${k}`,
    `channels:${handle}`,
  );
  const data = await resp.json();
  const item = data.items?.[0];
  if (!item) throw new Error(`No YouTube channel found for @${handle}`);
  return {
    channelId: item.id,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
    title: item.snippet.title,
    thumbnailUrl: item.snippet.thumbnails?.default?.url || null,
    handle: '@' + handle,
  };
}

/** List the latest `limit` videos from a channel's uploads playlist. */
export async function listLatestVideos(uploadsPlaylistId: string, limit: number): Promise<ChannelVideo[]> {
  const resp = await fetchWithKeyRotation(
    (k) => `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${uploadsPlaylistId}&maxResults=${limit}&key=${k}`,
    `playlist:${uploadsPlaylistId}`,
  );
  const data = await resp.json();
  return (data.items || [])
    .map((v: Record<string, any>) => ({
      videoId: v.contentDetails?.videoId || v.snippet?.resourceId?.videoId,
      title: v.snippet?.title || '',
      publishedAt: v.contentDetails?.videoPublishedAt || v.snippet?.publishedAt || null,
    }))
    .filter((v: ChannelVideo) => !!v.videoId);
}

/** Insert a resolved channel (idempotent on channel_id). Returns the row id (0 if ignored). */
export function addChannel(c: ResolvedChannel, fetchCount = 5): number {
  const db = getDb();
  const r = db.prepare(
    `INSERT OR IGNORE INTO channels (platform, handle, channel_id, uploads_playlist_id, title, thumbnail_url, fetch_count)
     VALUES ('youtube', ?, ?, ?, ?, ?, ?)`,
  ).run(c.handle, c.channelId, c.uploadsPlaylistId, c.title, c.thumbnailUrl, fetchCount);
  return Number(r.lastInsertRowid);
}
```

- [ ] **Step 2: Write the resolve smoke script** `scripts/test-channel-resolve.ts`

```ts
import { config } from 'dotenv';
import path from 'path';
config({ path: path.join(process.cwd(), '.env.local') });
import { resolveChannel, listLatestVideos } from '../src/services/inspiration/channelCrawler';

(async () => {
  const c = await resolveChannel('https://www.youtube.com/@AlexHormozi');
  console.log('resolved:', c.handle, c.channelId, c.title);
  const vids = await listLatestVideos(c.uploadsPlaylistId, 5);
  console.log('latest videos:', vids.length);
  vids.forEach((v) => console.log(' ', v.publishedAt?.slice(0, 10), v.videoId, v.title.slice(0, 50)));
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
```

- [ ] **Step 3: Run the resolve smoke test**

Run: `cd dashboard && npx tsx scripts/test-channel-resolve.ts`
Expected: prints `resolved: @AlexHormozi UCUyDOdBWhC1MCxEjC46d-zw Alex Hormozi` and 5 videos with ids/titles.

- [ ] **Step 4: Verify compile**

Run: `cd dashboard && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i 'channelCrawler' || echo "channelCrawler clean"`
Expected: `channelCrawler clean`

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/services/inspiration/channelCrawler.ts dashboard/scripts/test-channel-resolve.ts
git commit -m "feat(channels): resolve channel + list latest videos"
```

---

## Task 4: Crawl orchestration + seeding

**Files:** Modify `src/services/inspiration/channelCrawler.ts`; Create `scripts/test-channel-crawl.ts`, `scripts/seed-channels.ts`

- [ ] **Step 1: Append the crawl + seed functions** to `channelCrawler.ts`

```ts
import { createSourceRow, runIngest } from '@/services/inspiration/pipeline';
import type { IngestInput } from './types';

interface ChannelRow {
  id: number;
  channel_id: string;
  uploads_playlist_id: string;
  title: string | null;
  fetch_count: number;
}

/** Crawl one channel: list latest, skip already-ingested (by external_id), ingest the rest sequentially. */
export async function crawlChannel(channelRow: ChannelRow): Promise<{ discovered: number; ingested: number; skipped: number }> {
  const db = getDb();
  const videos = await listLatestVideos(channelRow.uploads_playlist_id, channelRow.fetch_count);
  let ingested = 0;
  let skipped = 0;
  for (const v of videos) {
    const exists = db.prepare('SELECT 1 FROM content_summaries WHERE external_id = ?').get(v.videoId);
    if (exists) { skipped++; continue; }
    const input: IngestInput = {
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      title: v.title,
      channelId: channelRow.id,
      externalId: v.videoId,
    };
    const sourceId = createSourceRow(input);
    try {
      await runIngest(sourceId, input);
      ingested++;
    } catch (e) {
      log.warn({ videoId: v.videoId, err: (e as Error).message }, 'ingest failed during crawl');
    }
  }
  db.prepare("UPDATE channels SET last_crawled_at = datetime('now') WHERE id = ?").run(channelRow.id);
  log.info({ channel: channelRow.title, discovered: videos.length, ingested, skipped }, 'Channel crawled');
  return { discovered: videos.length, ingested, skipped };
}

/** Crawl every active channel sequentially. */
export async function crawlAllActive(): Promise<{ channels: number; ingested: number; skipped: number }> {
  const db = getDb();
  const rows = db.prepare(
    'SELECT id, channel_id, uploads_playlist_id, title, fetch_count FROM channels WHERE active = 1',
  ).all() as ChannelRow[];
  let ingested = 0;
  let skipped = 0;
  for (const row of rows) {
    const r = await crawlChannel(row);
    ingested += r.ingested;
    skipped += r.skipped;
  }
  return { channels: rows.length, ingested, skipped };
}

const DEFAULT_HANDLES = ['@AlexHormozi', '@nateherk', '@garytalksstuff', '@SiliconValleyGirl', '@LennysPodcast'];

/** Idempotently resolve + insert the default channels. Returns how many were newly added. */
export async function seedDefaultChannels(): Promise<number> {
  const db = getDb();
  let added = 0;
  for (const h of DEFAULT_HANDLES) {
    if (db.prepare('SELECT 1 FROM channels WHERE handle = ?').get(h)) continue;
    try {
      const c = await resolveChannel(h);
      if (addChannel(c) > 0) added++;
    } catch (e) {
      log.warn({ handle: h, err: (e as Error).message }, 'seed resolve failed');
    }
  }
  return added;
}
```

- [ ] **Step 2: Write the seed script** `scripts/seed-channels.ts` (committed — not a `test-*` throwaway)

```ts
import { config } from 'dotenv';
import path from 'path';
config({ path: path.join(process.cwd(), '.env.local') });
import { seedDefaultChannels } from '../src/services/inspiration/channelCrawler';
import { getDb } from '../src/db';

(async () => {
  const added = await seedDefaultChannels();
  const rows = getDb().prepare('SELECT handle, title, channel_id FROM channels ORDER BY id').all();
  console.log(`seeded (newly added: ${added}). channels now:`);
  rows.forEach((r: any) => console.log(' ', r.handle, '→', r.title));
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
```

- [ ] **Step 3: Write the crawl smoke script** `scripts/test-channel-crawl.ts`

```ts
import { config } from 'dotenv';
import path from 'path';
config({ path: path.join(process.cwd(), '.env.local') });
import { resolveChannel, addChannel, crawlChannel } from '../src/services/inspiration/channelCrawler';
import { getDb } from '../src/db';

(async () => {
  // Use a single channel with fetch_count 1 to keep the smoke cheap.
  const c = await resolveChannel('https://www.youtube.com/@nateherk');
  addChannel(c, 1);
  const db = getDb();
  const row = db.prepare('SELECT id, channel_id, uploads_playlist_id, title, fetch_count FROM channels WHERE channel_id = ?').get(c.channelId) as any;
  console.log('crawling:', row.title, 'fetch_count', row.fetch_count);
  const r1 = await crawlChannel(row);
  console.log('first crawl:', r1);   // expect ingested 1 (or 0 if already there), discovered 1
  const r2 = await crawlChannel(row);
  console.log('second crawl (dedup):', r2);  // expect ingested 0, skipped 1
  const insights = db.prepare(
    `SELECT COUNT(*) c FROM insights i JOIN content_summaries cs ON cs.id = i.source_id WHERE cs.channel_id = ?`,
  ).get(row.id) as { c: number };
  console.log('insights linked to channel:', insights.c);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
```

- [ ] **Step 4: Run the crawl smoke test** (real APIFY + LLM; ~1-2 min for 1 video)

Run: `cd dashboard && npx tsx scripts/test-channel-crawl.ts`
Expected: `first crawl: { discovered: 1, ingested: 1, skipped: 0 }` (or `ingested:0, skipped:1` if that video was already ingested), `second crawl (dedup): { discovered: 1, ingested: 0, skipped: 1 }`, and `insights linked to channel: > 0`.

- [ ] **Step 5: Build**

Run: `cd dashboard && npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/services/inspiration/channelCrawler.ts dashboard/scripts/seed-channels.ts dashboard/scripts/test-channel-crawl.ts
git commit -m "feat(channels): crawlChannel + crawlAllActive + seed; dedup verified"
```

---

## Task 5: API routes

**Files:** Create the 4 route files under `src/app/api/inspiration/channels/`

- [ ] **Step 1: `channels/route.ts`** (GET list, POST add)

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { resolveChannel, addChannel } from '@/services/inspiration/channelCrawler';

/** List channels with an ingested-count per channel. */
export async function GET() {
  const db = getDb();
  const channels = db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM content_summaries cs WHERE cs.channel_id = c.id) AS ingested_count
     FROM channels c ORDER BY c.created_at DESC`,
  ).all();
  return NextResponse.json({ channels });
}

/** Add a channel by URL. Body: { url: string, fetchCount?: number }. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (!body.url || typeof body.url !== 'string') return NextResponse.json({ error: 'url required' }, { status: 400 });
  try {
    const c = await resolveChannel(body.url);
    addChannel(c, typeof body.fetchCount === 'number' ? body.fetchCount : 5);
    const row = getDb().prepare('SELECT * FROM channels WHERE channel_id = ?').get(c.channelId);
    return NextResponse.json({ channel: row });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
```

- [ ] **Step 2: `channels/[id]/route.ts`** (PATCH, DELETE)

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

/** Body: { active?: boolean, fetchCount?: number } */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const db = getDb();
  if (typeof body.active === 'boolean') db.prepare('UPDATE channels SET active = ? WHERE id = ?').run(body.active ? 1 : 0, Number(id));
  if (typeof body.fetchCount === 'number') db.prepare('UPDATE channels SET fetch_count = ? WHERE id = ?').run(body.fetchCount, Number(id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  getDb().prepare('DELETE FROM channels WHERE id = ?').run(Number(id));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: `channels/[id]/crawl/route.ts`** (POST, fire-and-forget)

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { crawlChannel } from '@/services/inspiration/channelCrawler';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:channel-crawl');

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getDb().prepare(
    'SELECT id, channel_id, uploads_playlist_id, title, fetch_count FROM channels WHERE id = ?',
  ).get(Number(id)) as { id: number } | undefined;
  if (!row) return NextResponse.json({ error: 'channel not found' }, { status: 404 });
  crawlChannel(row as never).catch((e) => log.error({ id, err: (e as Error).message }, 'crawl failed'));
  return NextResponse.json({ started: true });
}
```

- [ ] **Step 4: `channels/crawl-all/route.ts`** (POST, fire-and-forget)

```ts
import { NextResponse } from 'next/server';
import { crawlAllActive } from '@/services/inspiration/channelCrawler';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:channel-crawl-all');

export async function POST() {
  crawlAllActive().catch((e) => log.error({ err: (e as Error).message }, 'crawl-all failed'));
  return NextResponse.json({ started: true });
}
```

- [ ] **Step 5: Build + confirm routes registered**

Run: `cd dashboard && npm run build 2>&1 | grep -E "/api/inspiration/channels"`
Expected: lists `/api/inspiration/channels`, `/api/inspiration/channels/[id]`, `/api/inspiration/channels/[id]/crawl`, `/api/inspiration/channels/crawl-all`.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/app/api/inspiration/channels
git commit -m "feat(channels): API routes (list/add/patch/delete/crawl/crawl-all)"
```

---

## Task 6: Channels management UI + seed run

**Files:** Create `src/app/inspiration/channels/page.tsx`; Modify `src/app/inspiration/page.tsx`

- [ ] **Step 1: Write `src/app/inspiration/channels/page.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';

interface Channel {
  id: number; handle: string | null; title: string | null; thumbnail_url: string | null;
  active: number; fetch_count: number; last_crawled_at: string | null; ingested_count: number;
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/inspiration/channels');
    const data = await res.json();
    setChannels(data.channels || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!url.trim()) return;
    setBusy('add');
    const res = await fetch('/api/inspiration/channels', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim() }),
    });
    const data = await res.json();
    setBusy(null);
    if (data.error) alert(data.error); else { setUrl(''); load(); }
  };

  const crawl = async (id: number) => {
    setBusy(`c${id}`);
    await fetch(`/api/inspiration/channels/${id}/crawl`, { method: 'POST' });
    setBusy(null);
    alert('開始抓取（背景執行）。完成後重新整理看 insight 數變化。');
  };

  const crawlAll = async () => {
    setBusy('all');
    await fetch('/api/inspiration/channels/crawl-all', { method: 'POST' });
    setBusy(null);
    alert('開始抓取全部頻道（背景執行）。');
  };

  const toggle = async (c: Channel) => {
    await fetch(`/api/inspiration/channels/${c.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !c.active }),
    });
    load();
  };

  const remove = async (id: number) => {
    if (!confirm('移除這個頻道？（已抓的 insight 會保留）')) return;
    await fetch(`/api/inspiration/channels/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-brand">頻道來源</h1>
        <div className="flex gap-2">
          <a href="/inspiration" className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700">← 靈感庫</a>
          <button onClick={crawlAll} disabled={busy === 'all'}
            className="px-3 py-1.5 text-sm rounded-lg bg-brand/15 text-brand hover:bg-brand/25 disabled:opacity-50">
            {busy === 'all' ? '抓取中…' : '全部抓取'}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mb-6 flex gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="貼上 YouTube 頻道網址（如 https://www.youtube.com/@LennysPodcast）"
          className="flex-1 px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-100" />
        <button onClick={add} disabled={busy === 'add' || !url.trim()}
          className="px-3 py-1.5 text-sm rounded-lg bg-brand/15 text-brand hover:bg-brand/25 disabled:opacity-50">
          {busy === 'add' ? '加入中…' : '+ 加入頻道'}
        </button>
      </div>

      {loading ? <p className="text-zinc-400">載入中…</p>
        : channels.length === 0 ? <p className="text-zinc-400">還沒有頻道。貼一個 YouTube 頻道網址開始。</p>
        : channels.map((c) => (
          <div key={c.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mb-3 flex items-center gap-3">
            {c.thumbnail_url && <img src={c.thumbnail_url} alt="" className="w-10 h-10 rounded-full" />}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-zinc-100 truncate">{c.title || c.handle}</p>
              <p className="text-xs text-zinc-500">{c.handle} · {c.ingested_count} 篇已抓 · 每次抓 {c.fetch_count} · {c.last_crawled_at ? `上次 ${c.last_crawled_at.slice(0, 16)}` : '尚未抓取'}</p>
            </div>
            <button onClick={() => crawl(c.id)} disabled={busy === `c${c.id}`}
              className="px-2 py-1 text-xs rounded-lg bg-brand/15 text-brand hover:bg-brand/25 disabled:opacity-50">{busy === `c${c.id}` ? '…' : '立即抓取'}</button>
            <button onClick={() => toggle(c)}
              className={`px-2 py-1 text-xs rounded-lg ${c.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-400'} hover:opacity-80`}>{c.active ? '啟用中' : '已停用'}</button>
            <button onClick={() => remove(c.id)} className="px-2 py-1 text-xs rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700">移除</button>
          </div>
        ))}
    </div>
  );
}
```

- [ ] **Step 2: Add a header link on the main inspiration page**

In `src/app/inspiration/page.tsx`, find the header line:
```tsx
      <h1 className="text-xl font-bold text-brand mb-4">靈感庫</h1>
```
Replace it with a row that adds a link to the channels page:
```tsx
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-brand">靈感庫</h1>
        <a href="/inspiration/channels" className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700">頻道來源 →</a>
      </div>
```

- [ ] **Step 3: Build**

Run: `cd dashboard && npm run build 2>&1 | grep -E "/inspiration/channels|Compiled successfully"`
Expected: `/inspiration/channels` appears and build compiles.

- [ ] **Step 4: Seed the 5 channels**

Run: `cd dashboard && npx tsx scripts/seed-channels.ts`
Expected: prints all 5 channels resolved (`@AlexHormozi → Alex Hormozi`, etc.).

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/app/inspiration/channels/page.tsx dashboard/src/app/inspiration/page.tsx
git commit -m "feat(channels): management UI + link from inspiration page"
```

---

## Task 7: Final end-to-end verification

- [ ] **Step 1: Full build**

Run: `cd dashboard && npm run build`
Expected: clean build; `/inspiration/channels` + all 4 `/api/inspiration/channels/*` routes present.

- [ ] **Step 2: Confirm seed + dedup at the data layer**

Run: `cd dashboard && npx tsx -e "import { getDb } from './src/db'; const db=getDb(); console.log('channels:', db.prepare('SELECT COUNT(*) c FROM channels').get()); console.log('active:', db.prepare('SELECT COUNT(*) c FROM channels WHERE active=1').get());"`
Expected: `channels: { c: 5 }` (after seeding), `active: { c: 5 }`.

- [ ] **Step 3: Restart the dashboard service so the new routes/page are live**

Run: `launchctl kickstart -k gui/$(id -u)/com.podcast.dashboard`
Then verify over HTTPS (the dev server uses `--experimental-https`):
`sleep 25; curl -sk -m 30 -o /dev/null -w "%{http_code}\n" https://localhost:3000/inspiration/channels` and `curl -sk -m 15 https://localhost:3000/api/inspiration/channels | head -c 300`
Expected: page returns `200`; the API returns the 5 seeded channels as JSON.

- [ ] **Step 4: Commit any final cleanup**

```bash
git add -A && git commit -m "chore(channels): final verification" || echo "nothing to commit"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** channels table + content_summaries columns (Task 1), IngestInput/createSourceRow (Task 2), resolveChannel/listLatestVideos (Task 3), crawlChannel/crawlAllActive/seed + dedup (Task 4), 6 API endpoints across 4 route files (Task 5), Channels UI + header link + seed (Task 6), end-to-end + live verify (Task 7). Scheduling hook = `crawlAllActive()` exists as a clean entry point (noted in spec, not wired to cron). Latest-N-only / no back-catalog / YouTube-only all honored.
- **Type consistency:** `IngestInput` gains `channelId`/`externalId`, used identically in `createSourceRow` (Task 2) and `crawlChannel` (Task 4). `ChannelVideo` (`videoId/title/publishedAt`) and `ResolvedChannel` (`channelId/uploadsPlaylistId/title/thumbnailUrl/handle`) are consistent across resolver, lister, crawler, seed, and routes. `crawlChannel` reads `channels` columns (`id/channel_id/uploads_playlist_id/title/fetch_count`) that match the Task 1 schema.
- **Dedup semantics:** dedup is by `content_summaries.external_id` on ANY status (a failed video won't auto-retry on re-crawl) — matches the spec's documented limitation.
- **No placeholders:** every step has concrete code/commands + expected output.
- **Known smoke caveat:** `scripts/seed-channels.ts` and `scripts/test-channel-*.ts` — only `test-*` is gitignored; `seed-channels.ts` is committed intentionally (a real utility).
```
