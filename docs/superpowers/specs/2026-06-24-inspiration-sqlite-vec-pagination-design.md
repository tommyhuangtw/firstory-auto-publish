# Sub-project A — sqlite-vec + Pagination Design Spec

**Date**: 2026-06-24
**Status**: Approved design, ready for implementation planning
**Builds on**: [[inspiration-library]] + the channel-crawl/browse work. The library now holds 524+ insights (over the current `LIMIT 500`), so this is the scaling foundation everything else stands on.

---

## 1. Problem & Goal

The insights list/search currently fetches `... LIMIT 500` and, for semantic search, parses every row's embedding JSON and computes cosine **in Node**. At 524 insights this already truncates ranking; at thousands it breaks (search misses older rows; the DOM chokes). Replace it with:
- **sqlite-vec** for native, indexed vector search (no JS cosine, no 500-cap on search).
- **Keyset pagination + infinite scroll** for browsing the whole library ("一直滑").

**Feasibility (verified):** `better-sqlite3` 12.9.0 supports `loadExtension`; `sqlite-vec` 0.1.9 is on npm; Node 22.

---

## 2. Scope

### ✅ This sub-project
- Load `sqlite-vec` into the DB singleton.
- A `vec_insights` vec0 virtual table mirroring `insights.embedding`; backfill the existing rows; keep in sync on insert.
- Semantic search via sqlite-vec KNN (replaces the JS-cosine path), with status/channel/category/theme filters applied after KNN.
- Pagination on the insights list:
  - `newest` / `resonance` → **keyset cursor + infinite scroll** (page size 30).
  - `random` → a fresh batch of N each shuffle (no scroll).
  - semantic `q` → top-K ranked (no pagination).

### 🔜 Later / out of scope
- ANN indexing (only needed at millions of vectors; sqlite-vec brute-force is fine at our scale).
- Theme tags (sub-project C — separate spec).
- Postgres/pgvector migration (only if we ever outgrow SQLite).

---

## 3. Storage

- **`insights.embedding` (existing JSON) stays the source of truth** — clustering (C) and resonance scoring read it.
- **`vec_insights`** (NEW vec0 virtual table) is the search index, synced alongside:
  ```sql
  CREATE VIRTUAL TABLE IF NOT EXISTS vec_insights USING vec0(
    insight_id INTEGER PRIMARY KEY,
    embedding  float[1536]
  );
  ```
- `sqlite-vec` is loaded once in `db/index.ts` init via `sqliteVec.load(_db)` **before** the vec0 table is created.

---

## 4. Sync & Backfill

- **On insert** (`pipeline.ts` `runIngest`): after inserting an insight with an embedding, also insert into `vec_insights(insight_id, embedding)`. (Binding format — JSON string vs Float32 buffer — pinned in the plan with a verification step.)
- **Backfill**: a one-shot script populates `vec_insights` from all existing `insights` rows that have an embedding.
- Insights without an embedding (rare) are simply absent from `vec_insights` and fall back to non-semantic ordering.

---

## 5. Search & Query Flow

`GET /api/inspiration/insights` is reworked:

```
semantic (q present):
  qv = embedText(q)
  candidate_ids = SELECT insight_id FROM vec_insights WHERE embedding MATCH qv ORDER BY distance LIMIT K(=200)
  → SELECT insights JOIN content_summaries (+ channels) WHERE id IN candidate_ids AND <filters>
  → preserve KNN order, return top `limit`

browse (no q):
  newest:    WHERE <filters> AND keyset(created_at,id < cursor) ORDER BY created_at DESC, id DESC LIMIT 30
  resonance: WHERE <filters> AND keyset(resonance,id < cursor) ORDER BY resonance DESC, id DESC LIMIT 30
  random:    WHERE <filters> ORDER BY RANDOM() LIMIT N(=60)   (no cursor)
  → return { insights, nextCursor }   (nextCursor null when no more)
```

Filters (status / channel / category / theme) are applied in the SQL `WHERE` in all modes. KNN over-fetches (K=200) so post-filtering still yields a full page.

---

## 6. UI (`/inspiration` wall)

- **Infinite scroll**: an IntersectionObserver sentinel at the bottom requests the next page using `nextCursor`; results append. Resets when filters/sort/search change.
- **random**: 🎲 button replaces the list with a fresh random batch (no scroll-append).
- **semantic search**: shows top-K ranked (existing behavior, now backed by sqlite-vec).
- Loading/end states ("沒有更多了").

---

## 7. Success Criteria (verifiable)

1. `sqliteVec.load` succeeds in the DB init; `vec_insights` exists and is backfilled with 524 rows.
2. Semantic search returns sqlite-vec KNN results (verified: a query returns sensibly-ranked insights; no JS cosine in the path).
3. Browsing `newest`/`resonance` pages 30 at a time and infinite-scroll loads subsequent pages past 500 total (a row beyond the first 500 is reachable by scrolling).
4. Filters (channel/category) compose correctly with both search and browse.
5. New ingests auto-appear in `vec_insights` (crawl one video → its insights are semantically searchable).
6. `npm run build` passes; a smoke script asserts KNN search + pagination.

---

## 8. Out-of-Scope Reminders
- No theme tags here (C). No ANN. `insights.embedding` JSON remains; `vec_insights` is an additive index, not a replacement.
