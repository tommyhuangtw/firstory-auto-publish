# Channel Registry + Incremental Crawl — Design Spec

**Date**: 2026-06-24
**Status**: Approved design, ready for implementation planning
**Branch**: `feat/inspiration-corpus`
**Builds on**: [[inspiration-library]] (`2026-06-24-inspiration-library-design.md`) — reuses its ingest pipeline (`createSourceRow` + `runIngest`).

---

## 1. Problem & Goal

Tommy wants to fill the inspiration library from a curated set of creators' channels, automatically. Instead of pasting one URL at a time, register a channel once → the system grabs its latest videos → feeds them through the existing ingest pipeline (transcript → insights). It must **track which videos have already been ingested** so periodic re-crawls only pick up new uploads, and support adding more channels over time.

First five channels (YouTube):
- `@AlexHormozi` (business/sales), `@nateherk` (AI automation), `@garytalksstuff` (中文 AI, "Gary Chen"), `@SiliconValleyGirl` (AI startup/career), `@LennysPodcast` (product/AI interviews).

**Key insight validated:** Lenny's Podcast publishes the same episodes on YouTube — crawling the YouTube channel gets the transcript via APIFY for free (no Whisper). So for podcasts that are also on YouTube, prefer the channel crawl over the audio feed.

---

## 2. Scope

### ✅ This sub-project
- `channels` registry table + a small **Channels** management UI (add by URL, list, "立即抓取", show last-crawled + ingested count).
- Resolve a YouTube handle/URL → channelId + uploads playlist (Data API, via existing `fetchWithKeyRotation`).
- Incremental crawl: fetch latest N videos, **skip already-ingested** (dedup by video id), ingest only new ones via the existing pipeline.
- Seed the 5 channels above.
- Manual trigger (per-channel + crawl-all) now; a documented hook for the existing `scheduler` to run it daily later.

### 🔜 Later (separate sub-projects, per the agreed A→B→C→D plan)
- Full back-catalog crawl (this is latest-N only).
- sqlite-vec migration + SQL-side ranking (sub-project A) — not needed at ~80 insights.
- Auto-theme clustering / tags (sub-project C).
- Whisper-based podcast-feed channel crawl (Apple back-catalog).

### ❌ Non-goals
- No cross-platform content dedup (the YouTube "Fiona Fung" video and the Apple episode of the same talk are treated as two sources — acceptable).
- No automatic scheduling enabled in this sub-project (only the hook is documented).

---

## 3. Data Model

### 3.1 `channels` (NEW)

```
id                  INTEGER PK
platform            TEXT NOT NULL DEFAULT 'youtube'
handle              TEXT            -- '@AlexHormozi' (display)
channel_id          TEXT            -- resolved 'UC...' (dedup key for the channel)
uploads_playlist_id TEXT            -- resolved 'UU...'
title               TEXT
thumbnail_url       TEXT
active              INTEGER NOT NULL DEFAULT 1
fetch_count         INTEGER NOT NULL DEFAULT 5   -- how many latest videos per crawl
last_crawled_at     TEXT
created_at          TEXT DEFAULT (datetime('now'))
```
Index: unique on `channel_id` (avoid duplicate registrations).

### 3.2 `content_summaries` (existing — add 2 columns via `safeAlter`)

```
+ channel_id   INTEGER   -- → channels.id; NULL for manual one-off ingests
+ external_id  TEXT      -- YouTube video_id (or Apple episode id); dedup key
```
Index: `idx_content_summaries_external ON content_summaries(external_id)`.

**Dedup rule:** a crawl skips any video whose `external_id` already has a `content_summaries` row (any status — so a failed ingest isn't retried automatically on every crawl; manual retry stays available). Documented limitation: a previously-failed video won't auto-retry on re-crawl.

### 3.3 IngestInput extension

`IngestInput` (from inspiration-library) gains two optional fields:
```
channelId?: number;
externalId?: string;
```
`createSourceRow` writes `channel_id` + `external_id` when present. No change to the manual-paste path (both undefined).

---

## 4. Channel Resolution

`resolveChannel(urlOrHandle)` → `{ channelId, uploadsPlaylistId, title, thumbnailUrl, handle }`

```
parse handle from URL (youtube.com/@Handle) or accept raw @Handle
→ GET youtube/v3/channels?part=contentDetails,snippet&forHandle={handle}   (via fetchWithKeyRotation)
→ channelId = items[0].id
→ uploadsPlaylistId = items[0].contentDetails.relatedPlaylists.uploads
→ title = items[0].snippet.title, thumbnailUrl = items[0].snippet.thumbnails.default.url
```
Validated against all 5 handles. Throws a clear error if the handle resolves to no channel.

---

## 5. Crawl Flow

New module `src/services/inspiration/channelCrawler.ts`:

```
listLatestVideos(uploadsPlaylistId, limit): {videoId, title, publishedAt}[]
   → GET youtube/v3/playlistItems?part=snippet,contentDetails&playlistId={uploads}&maxResults={limit}  (fetchWithKeyRotation)

crawlChannel(channelRow): { discovered, ingested, skipped }
   videos = listLatestVideos(channelRow.uploads_playlist_id, channelRow.fetch_count)
   for each video:
     if EXISTS(content_summaries where external_id = video.videoId): skipped++ ; continue
     sourceId = createSourceRow({ url: `https://www.youtube.com/watch?v=${videoId}`,
                                  title: video.title, channelId: channelRow.id, externalId: videoId })
     runIngest(sourceId, {url, channelId, externalId})   // background, reuses existing pipeline
     ingested++
   UPDATE channels SET last_crawled_at = datetime('now') WHERE id = channelRow.id

crawlAllActive(): for each channels row where active=1 → crawlChannel   // sequential, background
```

Crawl is **fire-and-forget** (mirrors the existing ingest route): the API kicks it off and returns immediately; each video's `runIngest` updates `content_summaries.status` as it completes. The Channels UI polls / refreshes to show progress (ingested count per channel).

Cost/time: 25 videos ≈ ~10-15 min, ~$0.15 (APIFY transcript + cheap LLM extraction; no Whisper).

---

## 6. API Routes

```
GET    /api/inspiration/channels                 list channels (+ ingested count per channel)
POST   /api/inspiration/channels                 add a channel { url }  → resolveChannel + insert
PATCH  /api/inspiration/channels/{id}            toggle active / set fetch_count
DELETE /api/inspiration/channels/{id}            remove a channel
POST   /api/inspiration/channels/{id}/crawl      crawl one channel (background)
POST   /api/inspiration/channels/crawl-all       crawl all active (background)
```

---

## 7. UI — `/inspiration/channels`

A small management page (mirrors existing dashboard table/list patterns, inline Tailwind, brand classes):
- **Add channel**: paste a YouTube channel URL → resolves + adds (shows title + thumbnail).
- **List**: each channel row → thumbnail, title, handle, active toggle, fetch_count, last_crawled_at, ingested-count, **「立即抓取」** button.
- **「全部抓取」** button (crawl-all).
- A link from the main `/inspiration` page header to this Channels page.

---

## 8. Seeding

On first load (or a one-shot seed script), insert the 5 channels above (resolved to channelId + uploads playlist). Implemented as an idempotent seed (insert-or-ignore on `channel_id`) so it runs safely once. Tommy can add/remove channels via the UI afterward.

---

## 9. Scheduling Hook (documented, not built)

The project's `scheduler` service (node-cron) can later register a daily job calling `crawlAllActive()`. This spec only ensures `crawlAllActive()` is a clean, callable entry point. No cron is registered in this sub-project.

---

## 10. Success Criteria (verifiable)

1. Adding `https://www.youtube.com/@AlexHormozi` resolves to channelId `UCUyDOdBWhC1MCxEjC46d-zw` + uploads playlist, stored in `channels`.
2. Crawling that channel ingests its latest 5 videos → new `insights` rows appear on `/inspiration`, each linked to the channel (`content_summaries.channel_id`).
3. Re-crawling the same channel immediately reports `ingested: 0, skipped: 5` (dedup works) — no duplicate ingestion.
4. Seeding inserts all 5 channels; `crawl-all` ingests new videos across all of them in one background run.
5. The Channels page lists all 5, shows last-crawled + ingested counts, and the "立即抓取" / "全部抓取" buttons trigger crawls.
6. `npm run build` passes; end-to-end smoke (`scripts/test-channel-crawl.ts`) crawls one real channel and asserts insights were produced.

---

## 11. Out-of-Scope Reminders

- Latest-N only (no back-catalog); dedup by video id (no cross-platform content dedup); failed videos don't auto-retry on re-crawl; no cron enabled (hook only); search/clustering unchanged (current scale is fine).
