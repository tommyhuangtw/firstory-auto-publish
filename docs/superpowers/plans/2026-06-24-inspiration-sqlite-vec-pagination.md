# Sub-project A — sqlite-vec + Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the insights search/list (`LIMIT 500` + JS cosine) with native sqlite-vec KNN search + keyset/infinite-scroll pagination, so the library scales past 500 to tens of thousands.

**Architecture:** Load the `sqlite-vec` extension into the better-sqlite3 singleton; mirror `insights.embedding` into a `vec_insights` vec0 virtual table (kept in sync on insert, backfilled once). Semantic search runs a vec0 KNN then joins `insights` and applies filters; browse modes use keyset pagination. `insights.embedding` JSON stays the source of truth (clustering C + resonance read it); `vec_insights` is an additive index.

**Tech Stack:** `sqlite-vec` 0.1.9 (loadable extension, installed), better-sqlite3 12.9.0, Next.js 16.

**Verification convention (project CLAUDE.md):** no unit-test framework — verify via `npm run build`, `npx tsc --noEmit`, and `npx tsx scripts/<smoke>.ts`. Commit each task. Commit messages in English, no `Co-Authored-By`. Work on branch `feat/inspiration-corpus`.

**VERIFIED sqlite-vec patterns (probed live — use exactly these):**
```ts
import * as sqliteVec from 'sqlite-vec';
sqliteVec.load(db);                              // after opening the connection
// table: implicit rowid (NOT an explicit `id INTEGER PRIMARY KEY` — that throws)
db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS vec_insights USING vec0(embedding float[1536])');
const f32 = (a: number[]) => Buffer.from(new Float32Array(a).buffer);
// insert: rowid MUST be BigInt; embedding via vec_f32(?) with an f32 buffer
db.prepare('INSERT INTO vec_insights(rowid, embedding) VALUES (?, vec_f32(?))').run(BigInt(id), f32(vec));
// KNN: literal LIMIT works; bind query vec as f32 buffer
db.prepare('SELECT rowid AS insight_id, distance FROM vec_insights WHERE embedding MATCH vec_f32(?) ORDER BY distance LIMIT 200').all(f32(qv));
```

---

## File Structure

**New:**
- `src/services/inspiration/vectorIndex.ts` — `f32`, `upsertVec`, `removeVec`, `searchVec` (the only place that talks to `vec_insights`)
- `scripts/backfill-vec.ts` — one-shot populate `vec_insights` from existing `insights`

**Modify:**
- `package.json` / `package-lock.json` — add `sqlite-vec` (already installed; commit it)
- `src/db/index.ts` — `sqliteVec.load(_db)` + create `vec_insights` in init
- `src/services/inspiration/pipeline.ts` — `runIngest` upserts each new insight's vector
- `src/app/api/inspiration/insights/route.ts` — sqlite-vec KNN search + keyset pagination + random batch
- `src/app/inspiration/page.tsx` — infinite scroll + random batch + end state

---

## Task 1: Load sqlite-vec + create the vec0 table

**Files:** Modify `package.json` (commit the already-installed dep), `src/db/index.ts`

- [ ] **Step 1: Confirm the dependency is recorded**

Run: `cd dashboard && node -e "console.log(require('./package.json').dependencies['sqlite-vec'])"`
Expected: prints a version like `^0.1.9` (the package was installed during planning). If missing, run `npm install sqlite-vec`.

- [ ] **Step 2: Load the extension + create the table in `db/index.ts`**

In `src/db/index.ts`, add the import at the top with the other imports:
```ts
import * as sqliteVec from 'sqlite-vec';
```
Inside `getDb()`, immediately AFTER the connection is opened and pragmas are set (after `_db.pragma('foreign_keys = ON');` and before the schema/table creation), add:
```ts
  // Vector search extension (sqlite-vec). Must load before creating vec0 tables.
  try {
    sqliteVec.load(_db);
    _db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS vec_insights USING vec0(embedding float[1536])');
  } catch (e) {
    console.error('sqlite-vec load failed:', (e as Error).message);
  }
```

- [ ] **Step 3: Verify load + table**

Run: `cd dashboard && npx tsx -e "import { getDb } from './src/db'; const db=getDb(); console.log('vec_version:', db.prepare('select vec_version() as v').get()); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE name='vec_insights'\").all());"`
Expected: prints a `vec_version` like `{ v: 'v0.1.9' }` and `[ { name: 'vec_insights' } ]`.

- [ ] **Step 4: Build**

Run: `cd dashboard && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add dashboard/package.json dashboard/package-lock.json dashboard/src/db/index.ts
git commit -m "feat(vec): load sqlite-vec + create vec_insights vec0 table"
```

---

## Task 2: Vector index service

**Files:** Create `src/services/inspiration/vectorIndex.ts`

- [ ] **Step 1: Write the module**

```ts
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
```

- [ ] **Step 2: Verify compile + round-trip**

Run: `cd dashboard && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i 'vectorIndex' || echo "vectorIndex clean"`
Expected: `vectorIndex clean`

Run a round-trip (insert a dummy vector, search, remove):
`cd dashboard && npx tsx -e "import { upsertVec, searchVec, removeVec } from './src/services/inspiration/vectorIndex'; const v=Array(1536).fill(0); v[0]=1; upsertVec(999999, v); console.log('search hit:', searchVec(v, 3).includes(999999)); removeVec(999999); console.log('removed:', !searchVec(v,3).includes(999999));"`
Expected: `search hit: true` then `removed: true`.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/services/inspiration/vectorIndex.ts
git commit -m "feat(vec): vectorIndex service (upsert/remove/searchVec)"
```

---

## Task 3: Backfill existing insights into the index

**Files:** Create `scripts/backfill-vec.ts`

- [ ] **Step 1: Write the backfill script** (committed utility)

```ts
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
```

- [ ] **Step 2: Run the backfill**

Run: `cd dashboard && npx tsx scripts/backfill-vec.ts`
Expected: `backfilled vectors: 524 | vec_insights rows: 524` (counts ≈ current insight total; both equal and > 500).

- [ ] **Step 3: Commit**

```bash
git add dashboard/scripts/backfill-vec.ts
git commit -m "feat(vec): backfill script for vec_insights"
```

---

## Task 4: Sync new insights on ingest

**Files:** Modify `src/services/inspiration/pipeline.ts`

- [ ] **Step 1: Upsert the vector inside `runIngest`'s insert transaction**

In `src/services/inspiration/pipeline.ts`, add the import at the top:
```ts
import { upsertVec } from './vectorIndex';
```
The insert loop currently looks like:
```ts
    const tx = db.transaction(() => {
      candidates.forEach((c, i) => {
        const vec = vecs[i] || null;
        const resonance = scoreResonance(vec, profile);
        insert.run(sourceId, c.hook, c.idea, c.why_share, c.category, resonance, vec ? JSON.stringify(vec) : null, origin);
      });
    });
    tx();
```
Replace it so the new insight's vector is also indexed (capture `lastInsertRowid` and upsert when there's a vector):
```ts
    const tx = db.transaction(() => {
      candidates.forEach((c, i) => {
        const vec = vecs[i] || null;
        const resonance = scoreResonance(vec, profile);
        const r = insert.run(sourceId, c.hook, c.idea, c.why_share, c.category, resonance, vec ? JSON.stringify(vec) : null, origin);
        if (vec) upsertVec(Number(r.lastInsertRowid), vec);
      });
    });
    tx();
```

- [ ] **Step 2: Verify compile**

Run: `cd dashboard && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i 'inspiration/pipeline' || echo "pipeline clean"`
Expected: `pipeline clean`

- [ ] **Step 3: End-to-end sync check** (ingest one cheap video, confirm its insights are searchable)

Run: `cd dashboard && npx tsx -e "import { config } from 'dotenv'; import path from 'path'; config({ path: path.join(process.cwd(), '.env.local') }); (async()=>{ const { createSourceRow, runIngest } = await import('./src/services/inspiration/pipeline'); const { getDb } = await import('./src/db'); const before=(getDb().prepare('SELECT COUNT(*) c FROM vec_insights').get()).c; const input={url:'https://www.youtube.com/watch?v=nIk3DedjxJM'}; const id=createSourceRow(input); await runIngest(id, input); const after=(getDb().prepare('SELECT COUNT(*) c FROM vec_insights').get()).c; console.log('vec rows before/after:', before, after, '(should increase)'); })();"`
Expected: `vec rows before/after:` second number larger than the first.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/services/inspiration/pipeline.ts
git commit -m "feat(vec): index new insight vectors on ingest"
```

---

## Task 5: Rework the insights API (sqlite-vec search + keyset pagination + random)

**Files:** Modify `src/app/api/inspiration/insights/route.ts`

- [ ] **Step 1: Replace the GET handler**

Replace the whole `GET` function (and the top imports) in `src/app/api/inspiration/insights/route.ts` with:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { embedText } from '@/services/trends/embeddings';
import { searchVec } from '@/services/inspiration/vectorIndex';

const PAGE = 30;       // browse page size
const RANDOM_N = 60;   // random batch size

/** Query: ?status, ?sort=resonance|newest|random, ?q=<semantic>, ?channel, ?category,
 *  ?cursor=<keyset cursor for newest/resonance>, ?limit (semantic only). */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const status = sp.get('status') || 'visible';
  const sort = sp.get('sort') || 'resonance';
  const q = sp.get('q')?.trim();
  const channel = sp.get('channel');
  const category = sp.get('category');
  const cursor = sp.get('cursor');
  const db = getDb();

  // ---- filters (shared) ----
  const conds: string[] = [];
  const params: unknown[] = [];
  if (status === 'saved') conds.push("i.status = 'saved'");
  else if (status === 'new') conds.push("i.status = 'new'");
  else if (status === 'hidden') conds.push("i.status = 'hidden'");
  else conds.push("i.status != 'hidden'");
  if (channel) { conds.push('c.channel_id = ?'); params.push(Number(channel)); }
  if (category) { conds.push('i.category = ?'); params.push(category); }

  const baseSelect =
    `SELECT i.id, i.source_id, i.hook, i.idea, i.why_share, i.category, i.resonance, i.status, i.origin,
            c.title AS source_title, c.url AS source_url, c.source_type,
            ch.title AS channel_title, ch.handle AS channel_handle
     FROM insights i
     JOIN content_summaries c ON c.id = i.source_id
     LEFT JOIN channels ch ON ch.id = c.channel_id`;

  // ---- semantic search: sqlite-vec KNN, then filter + preserve order ----
  if (q) {
    const qv = await embedText(q);
    if (!qv) return NextResponse.json({ insights: [], nextCursor: null });
    const ids = searchVec(qv, 200);
    if (!ids.length) return NextResponse.json({ insights: [], nextCursor: null });
    const idList = ids.join(',');
    const where = ['i.id IN (' + idList + ')', ...conds].join(' AND ');
    const rows = db.prepare(`${baseSelect} WHERE ${where}`).all(...params) as Array<Record<string, unknown>>;
    const order = new Map(ids.map((id, idx) => [id, idx]));
    rows.sort((a, b) => (order.get(a.id as number)! - order.get(b.id as number)!));
    return NextResponse.json({ insights: rows.slice(0, 100), nextCursor: null });
  }

  // ---- random: fresh batch, no pagination ----
  if (sort === 'random') {
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const rows = db.prepare(`${baseSelect} ${where} ORDER BY RANDOM() LIMIT ${RANDOM_N}`).all(...params);
    return NextResponse.json({ insights: rows, nextCursor: null });
  }

  // ---- browse with keyset pagination (newest | resonance) ----
  const pageConds = [...conds];
  const pageParams = [...params];
  if (cursor) {
    const [cv, cid] = cursor.split('|');
    if (sort === 'newest') { pageConds.push('(i.created_at < ? OR (i.created_at = ? AND i.id < ?))'); pageParams.push(cv, cv, Number(cid)); }
    else { pageConds.push('(COALESCE(i.resonance,-1) < ? OR (COALESCE(i.resonance,-1) = ? AND i.id < ?))'); pageParams.push(Number(cv), Number(cv), Number(cid)); }
  }
  const orderBy = sort === 'newest' ? 'i.created_at DESC, i.id DESC' : 'COALESCE(i.resonance,-1) DESC, i.id DESC';
  const where = pageConds.length ? 'WHERE ' + pageConds.join(' AND ') : '';
  const rows = db.prepare(`${baseSelect} ${where} ORDER BY ${orderBy} LIMIT ${PAGE + 1}`).all(...pageParams) as Array<Record<string, unknown>>;

  let nextCursor: string | null = null;
  if (rows.length > PAGE) {
    const last = rows[PAGE - 1];
    nextCursor = sort === 'newest' ? `${last.created_at}|${last.id}` : `${last.resonance ?? -1}|${last.id}`;
  }
  return NextResponse.json({ insights: rows.slice(0, PAGE), nextCursor });
}
```
NOTE: `i.created_at` is selected implicitly via `i.*`? No — `baseSelect` lists explicit columns and does NOT include `created_at`. Add `i.created_at` to the `baseSelect` column list so the newest cursor can read `last.created_at`.

- [ ] **Step 2: Add `i.created_at` to the select list**

In the `baseSelect` string above, change the first line to include `i.created_at`:
```ts
    `SELECT i.id, i.source_id, i.created_at, i.hook, i.idea, i.why_share, i.category, i.resonance, i.status, i.origin,
```

- [ ] **Step 3: Build + functional checks**

Run: `cd dashboard && npm run build`
Expected: build succeeds.

Functional — semantic search via vec, and pagination cursor:
```
cd dashboard && npx tsx -e "import('./src/app/api/inspiration/insights/route').then(async m0=>{const m=(m0 as any).default||m0;
  const mk=(qs)=>({nextUrl:new URL('http://x/api/inspiration/insights?'+qs)});
  let r=await m.GET(mk('q=創業')); let j=await r.json(); console.log('semantic top:', j.insights[0]?.hook?.slice(0,30), '| n=', j.insights.length);
  r=await m.GET(mk('sort=newest')); j=await r.json(); console.log('page1 size:', j.insights.length, 'cursor:', !!j.nextCursor);
  r=await m.GET(mk('sort=newest&cursor='+encodeURIComponent(j.nextCursor))); const j2=await r.json(); console.log('page2 size:', j2.insights.length, 'distinct from p1:', j.insights[0].id!==j2.insights[0].id);
  r=await m.GET(mk('sort=random')); j=await r.json(); console.log('random n:', j.insights.length);
})"
```
Expected: semantic returns on-topic hooks (n>0); `page1 size: 30 cursor: true`; `page2 size: 30 distinct from p1: true`; `random n: 60`.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/app/api/inspiration/insights/route.ts
git commit -m "feat(inspiration): sqlite-vec search + keyset pagination + random batch"
```

---

## Task 6: Infinite scroll on the wall

**Files:** Modify `src/app/inspiration/page.tsx`

- [ ] **Step 1: Replace the load logic with cursor-aware paging + append**

In `src/app/inspiration/page.tsx`:
1. Add state for the cursor + "loading more" + an end flag (near the other `useState`s):
```ts
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
```
2. Replace the existing `load` callback with two functions — a fresh load (resets list) and a load-more (appends):
```ts
  const buildParams = useCallback((cur: string | null) => {
    const params = new URLSearchParams({ status: statusFilter, sort });
    if (q.trim()) params.set('q', q.trim());
    if (channel) params.set('channel', channel);
    if (category) params.set('category', category);
    if (cur) params.set('cursor', cur);
    return params;
  }, [statusFilter, sort, q, channel, category]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/inspiration/insights?${buildParams(null)}`);
    const data = await res.json();
    setInsights(data.insights || []);
    setCursor(data.nextCursor || null);
    setHasMore(!!data.nextCursor);
    setLoading(false);
  }, [buildParams]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !cursor) return;
    setLoadingMore(true);
    const res = await fetch(`/api/inspiration/insights?${buildParams(cursor)}`);
    const data = await res.json();
    setInsights((prev) => [...prev, ...(data.insights || [])]);
    setCursor(data.nextCursor || null);
    setHasMore(!!data.nextCursor);
    setLoadingMore(false);
  }, [hasMore, loadingMore, cursor, buildParams]);

  useEffect(() => { load(); }, [load]);
```
(Delete the old `load` definition that read only `[statusFilter, sort, q]` and the old single param block — it's replaced above.)

3. Update the `shuffle` helper to call the new `load`:
```ts
  const shuffle = () => { if (sort !== 'random') setSort('random'); else load(); };
```

- [ ] **Step 2: Add the infinite-scroll sentinel at the bottom of the list**

Right AFTER the `insights.map(...)` block (before the closing `</div>` of the page container), add:
```tsx
        {!loading && hasMore && sort !== 'random' && !q.trim() && (
          <IntersectionLoader onVisible={loadMore} busy={loadingMore} />
        )}
        {!loading && !hasMore && insights.length > 0 && <p className="text-center text-xs text-zinc-600 py-4">沒有更多了</p>}
```
And add this small component at the bottom of the file (after the default export's closing brace):
```tsx
function IntersectionLoader({ onVisible, busy }: { onVisible: () => void; busy: boolean }) {
  const ref = (el: HTMLDivElement | null) => {
    if (!el) return;
    const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) onVisible(); }, { rootMargin: '300px' });
    io.observe(el);
  };
  return <div ref={ref} className="py-4 text-center text-xs text-zinc-600">{busy ? '載入中…' : ''}</div>;
}
```

- [ ] **Step 3: Build**

Run: `cd dashboard && npm run build 2>&1 | grep -E "Compiled successfully|Type error" | head -2`
Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Restart dashboard + live check**

Run: `launchctl kickstart -k gui/$(id -u)/com.podcast.dashboard` then (after ~10s) load `https://localhost:3000/inspiration`, scroll to the bottom, and confirm more cards append past the first 30 (and past 500 total when scrolling far). Confirm 🎲 random still returns a fresh batch and semantic search still ranks.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/app/inspiration/page.tsx
git commit -m "feat(inspiration): infinite-scroll pagination on the wall"
```

---

## Task 7: Final verification

- [ ] **Step 1: Full build**

Run: `cd dashboard && npm run build`
Expected: clean build.

- [ ] **Step 2: Reachability past 500**

Run: `cd dashboard && npx tsx -e "import { getDb } from './src/db'; const db=getDb(); console.log('insights:', (db.prepare('SELECT COUNT(*) c FROM insights').get()).c, '| vec rows:', (db.prepare('SELECT COUNT(*) c FROM vec_insights').get()).c);"`
Expected: both counts equal (or vec ≈ insights with embeddings) and > 500.

- [ ] **Step 3: Semantic quality spot-check**

Run: `cd dashboard && npx tsx -e "import { config } from 'dotenv'; import path from 'path'; config({path:path.join(process.cwd(),'.env.local')}); (async()=>{ const { embedText } = await import('./src/services/trends/embeddings'); const { searchVec } = await import('./src/services/inspiration/vectorIndex'); const { getDb } = await import('./src/db'); const qv=await embedText('行銷與定位'); const ids=searchVec(qv,5); const rows=getDb().prepare('SELECT hook FROM insights WHERE id IN ('+ids.join(',')+')').all(); rows.forEach(r=>console.log(' ', r.hook.slice(0,46))); })();"`
Expected: 5 on-topic (marketing/positioning) hooks — confirms KNN returns semantically relevant results across the corpus.

- [ ] **Step 4: Commit any cleanup**

```bash
git add -A && git commit -m "chore(vec): final verification" || echo "nothing to commit"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** load sqlite-vec + vec0 table (T1), sync index service (T2), backfill (T3), insert-time sync (T4), KNN search + keyset pagination + random batch (T5), infinite scroll UI (T6), past-500 reachability + semantic quality (T7). `insights.embedding` JSON untouched as source of truth.
- **Type consistency:** `upsertVec(id, vec)` / `searchVec(qv, k): number[]` used identically in pipeline (T4) and the route (T5). `f32` defined once in vectorIndex. The route's `baseSelect` includes `i.created_at` (T5 step 2) which the newest cursor reads.
- **Verified gotchas baked in:** implicit `rowid` table, `BigInt` rowid binding, `vec_f32(?)` + Float32 buffer, literal KNN `LIMIT`. Random deliberately un-paginated; semantic returns top-K (no cursor).
- **No placeholders:** every step has concrete code + commands + expected output.
- **Known caveat:** semantic KNN over-fetches 200 then post-filters — if a very narrow filter + query yields < a page, that's acceptable (search is ranked, not paginated).
