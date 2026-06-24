# Sub-project C — Auto Theme Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every insight emergent topic-theme tags (創業/AI/行銷/創意…) derived from the corpus, and let the wall filter by theme.

**Architecture:** An LLM reads a representative sample of insights → proposes ~15 named themes; each theme is embedded; every insight is tagged with its top 1–2 nearest themes by cosine (`insights.embedding` JSON ↔ `themes.embedding`). New insights auto-tag on ingest. A theme filter is added to the insights API + a dropdown on the wall.

**Tech Stack:** `llmService` (OpenRouter), `embedTexts`/`cosine`/`parseEmbedding` from `@/services/trends/embeddings`, better-sqlite3, Next 16.

**Verification convention:** no unit-test framework — `npm run build`, `npx tsc --noEmit`, `npx tsx scripts/<smoke>.ts`. Commit each task. English commit messages, no `Co-Authored-By`. Branch `feat/inspiration-corpus`.

**Reusable signatures (verbatim):**
```ts
import { getLLMService } from '@/services/llmService';
// getLLMService().call({ stage, messages:[{role,content}], options:{temperature,maxTokens,models,retryCount,timeoutMs} }) → { success, content, error }
import { embedTexts, cosine, parseEmbedding } from '@/services/trends/embeddings';
// embedTexts(texts: string[]): Promise<(number[]|null)[]>;  cosine(a,b): number;  parseEmbedding(raw): number[]|null
import { getDb } from '@/db';
```
**Current insights API** (`src/app/api/inspiration/insights/route.ts`, from sub-project A) builds a shared `conds[]` / `params[]` filter block (status/channel/category) then branches into semantic / random / keyset-paged browse. This plan adds a `theme` filter into that shared block.

---

## File Structure
**New:**
- `src/services/inspiration/themeService.ts` — `deriveThemes`, `assignThemes`, `tagAllInsights`, `recomputeThemeCounts`
- `src/app/api/inspiration/themes/route.ts` — GET list
- `src/app/api/inspiration/themes/rederive/route.ts` — POST (background re-derive+re-tag)
- `scripts/derive-themes.ts` — one-shot derive + tag all (committed utility)

**Modify:**
- `src/db/index.ts` — `themes` + `insight_themes` tables + indexes
- `src/services/inspiration/pipeline.ts` — auto-tag new insights on ingest
- `src/app/api/inspiration/insights/route.ts` — add `?theme=` filter into the shared `conds`
- `src/app/inspiration/page.tsx` — theme dropdown

---

## Task 1: DB tables

**Files:** Modify `src/db/index.ts`

- [ ] **Step 1: Add the tables** (after the `channels` block)
```ts
_db!.exec(`
  CREATE TABLE IF NOT EXISTS themes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    description   TEXT,
    embedding     TEXT,
    insight_count INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now'))
  )
`);
_db!.exec(`
  CREATE TABLE IF NOT EXISTS insight_themes (
    insight_id INTEGER NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
    theme_id   INTEGER NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    score      REAL,
    PRIMARY KEY (insight_id, theme_id)
  )
`);
```

- [ ] **Step 2: Indexes** (near other `safeIndex`)
```ts
safeIndex('CREATE INDEX IF NOT EXISTS idx_insight_themes_theme ON insight_themes(theme_id)');
safeIndex('CREATE INDEX IF NOT EXISTS idx_insight_themes_insight ON insight_themes(insight_id)');
```

- [ ] **Step 3: Verify**
Run: `cd dashboard && npx tsx -e "import { getDb } from './src/db'; const db=getDb(); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('themes','insight_themes')\").all());"`
Expected: `[ { name: 'themes' }, { name: 'insight_themes' } ]`

- [ ] **Step 4: Commit**
```bash
git add dashboard/src/db/index.ts
git commit -m "feat(themes): add themes + insight_themes tables"
```

---

## Task 2: themeService — derive / assign / tag

**Files:** Create `src/services/inspiration/themeService.ts`

- [ ] **Step 1: Write the module**
```ts
import { getDb } from '@/db';
import { getLLMService } from '@/services/llmService';
import { embedTexts, cosine, parseEmbedding } from '@/services/trends/embeddings';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('theme-service');
const MIN_SCORE = 0.30;     // assignment floor
const MAX_THEMES_PER = 2;   // top-N themes per insight

interface ThemeRow { id: number; embedding: string | null }

/** Derive ~15 themes from a representative sample, embed them, replace the themes table. */
export async function deriveThemes(): Promise<number> {
  const db = getDb();
  const sample = db.prepare(
    `SELECT hook, idea FROM insights WHERE embedding IS NOT NULL ORDER BY RANDOM() LIMIT 120`,
  ).all() as Array<{ hook: string; idea: string }>;
  const list = sample.map((s, i) => `${i + 1}. ${s.hook}`).join('\n');

  const prompt = `以下是我內容靈感庫裡的代表性 insight（每則一句 hook）。請幫我歸納出大約 15 個「主題分類」，讓我之後可以按主題瀏覽（例如：創業、AI 應用、行銷、商業思維、創意發想、生產力、個人成長…，但請依實際內容歸納，不要硬塞）。
每個主題要：一個簡短的繁體中文名稱 + 一句話描述。主題之間不要重疊。

${list}

嚴格輸出 JSON，不要 markdown fence：
{ "themes": [ { "name": "...", "description": "..." } ] }`;

  const llm = getLLMService();
  const r = await llm.call({
    stage: 'theme_derive',
    messages: [{ role: 'user', content: prompt }],
    options: { temperature: 0.4, maxTokens: 1500, models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3.5-flash'], retryCount: 2, timeoutMs: 60_000 },
  });
  if (!r.success || !r.content) throw new Error(r.error || 'theme derive LLM failed');
  let cleaned = r.content.trim();
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  const obj = cleaned.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(obj ? obj[0] : cleaned) as { themes?: Array<{ name: string; description: string }> };
  const themes = (parsed.themes || []).filter((t) => t.name);
  if (!themes.length) throw new Error('LLM returned no themes');

  const vecs = await embedTexts(themes.map((t) => `${t.name} — ${t.description || ''}`));

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM themes').run();
    themes.forEach((t, i) => {
      const v = vecs[i];
      db.prepare('INSERT INTO themes (name, description, embedding) VALUES (?, ?, ?)')
        .run(t.name, t.description || '', v ? JSON.stringify(v) : null);
    });
  });
  tx();
  log.info({ count: themes.length }, 'Themes derived');
  return themes.length;
}

/** Cosine an insight embedding to all themes → top MAX_THEMES_PER above MIN_SCORE. */
export function assignThemes(insightVec: number[]): Array<{ themeId: number; score: number }> {
  const db = getDb();
  const themes = db.prepare('SELECT id, embedding FROM themes WHERE embedding IS NOT NULL').all() as ThemeRow[];
  const scored = themes
    .map((t) => { const v = parseEmbedding(t.embedding); return { themeId: t.id, score: v ? cosine(insightVec, v) : -1 }; })
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_THEMES_PER);
  return scored;
}

/** Write an insight's theme assignments (replaces any existing). */
export function setInsightThemes(insightId: number, assigned: Array<{ themeId: number; score: number }>): void {
  const db = getDb();
  db.prepare('DELETE FROM insight_themes WHERE insight_id = ?').run(insightId);
  const ins = db.prepare('INSERT OR IGNORE INTO insight_themes (insight_id, theme_id, score) VALUES (?, ?, ?)');
  for (const a of assigned) ins.run(insightId, a.themeId, a.score);
}

/** Re-tag every insight against the current themes; recompute counts. */
export function tagAllInsights(): { tagged: number } {
  const db = getDb();
  const rows = db.prepare('SELECT id, embedding FROM insights WHERE embedding IS NOT NULL').all() as Array<{ id: number; embedding: string }>;
  let tagged = 0;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM insight_themes').run();
    for (const r of rows) {
      const v = parseEmbedding(r.embedding);
      if (!v) continue;
      const assigned = assignThemes(v);
      if (assigned.length) { setInsightThemes(r.id, assigned); tagged++; }
    }
  });
  tx();
  recomputeThemeCounts();
  log.info({ tagged }, 'All insights tagged');
  return { tagged };
}

export function recomputeThemeCounts(): void {
  getDb().exec(
    `UPDATE themes SET insight_count = (SELECT COUNT(*) FROM insight_themes it WHERE it.theme_id = themes.id)`,
  );
}
```

- [ ] **Step 2: Verify compile**
Run: `cd dashboard && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i 'themeService' || echo "themeService clean"`
Expected: `themeService clean`

- [ ] **Step 3: Commit**
```bash
git add dashboard/src/services/inspiration/themeService.ts
git commit -m "feat(themes): derive/assign/tag service"
```

---

## Task 3: Derive + tag the corpus (script)

**Files:** Create `scripts/derive-themes.ts`

- [ ] **Step 1: Write the script**
```ts
import { config } from 'dotenv';
import path from 'path';
config({ path: path.join(process.cwd(), '.env.local') });
import { getDb } from '../src/db';
import { deriveThemes, tagAllInsights } from '../src/services/inspiration/themeService';

(async () => {
  const n = await deriveThemes();
  console.log('themes derived:', n);
  const { tagged } = tagAllInsights();
  console.log('insights tagged:', tagged);
  const rows = getDb().prepare('SELECT name, insight_count FROM themes ORDER BY insight_count DESC').all();
  rows.forEach((r: any) => console.log(`  ${String(r.insight_count).padStart(4)}  ${r.name}`));
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
```

- [ ] **Step 2: Run it**
Run: `cd dashboard && npx tsx scripts/derive-themes.ts`
Expected: `themes derived: ~15`, `insights tagged:` a number near the insight total (most insights get ≥1 theme), then a list of ~15 themes with counts (e.g. surfaces 創業 / AI / 行銷 style names). If many insights get 0 themes, MIN_SCORE may be too high — note it but the spec's 0.30 should be reasonable for text-embedding-3-small.

- [ ] **Step 3: Commit**
```bash
git add dashboard/scripts/derive-themes.ts
git commit -m "feat(themes): derive+tag corpus script"
```

---

## Task 4: Auto-tag on ingest

**Files:** Modify `src/services/inspiration/pipeline.ts`

- [ ] **Step 1: Tag each new insight after its vector is indexed**
Add import at top:
```ts
import { assignThemes, setInsightThemes } from './themeService';
```
In `runIngest`, the insert transaction currently (after sub-project A) does:
```ts
        const r = insert.run(sourceId, c.hook, c.idea, c.why_share, c.category, resonance, vec ? JSON.stringify(vec) : null, origin);
        if (vec) upsertVec(Number(r.lastInsertRowid), vec);
```
Extend the `if (vec)` body to also assign themes:
```ts
        if (vec) {
          const newId = Number(r.lastInsertRowid);
          upsertVec(newId, vec);
          setInsightThemes(newId, assignThemes(vec));
        }
```
(If no themes exist yet, `assignThemes` returns `[]` and `setInsightThemes` writes nothing — safe.)

- [ ] **Step 2: Verify compile**
Run: `cd dashboard && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i 'inspiration/pipeline' || echo "pipeline clean"`
Expected: `pipeline clean`

- [ ] **Step 3: Commit**
```bash
git add dashboard/src/services/inspiration/pipeline.ts
git commit -m "feat(themes): auto-tag new insights on ingest"
```

---

## Task 5: API — themes list + theme filter + rederive

**Files:** Create `src/app/api/inspiration/themes/route.ts`, `src/app/api/inspiration/themes/rederive/route.ts`; Modify `src/app/api/inspiration/insights/route.ts`

- [ ] **Step 1: `themes/route.ts`**
```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET() {
  const themes = getDb().prepare(
    'SELECT id, name, description, insight_count FROM themes ORDER BY insight_count DESC, id',
  ).all();
  return NextResponse.json({ themes });
}
```

- [ ] **Step 2: `themes/rederive/route.ts`** (fire-and-forget)
```ts
import { NextResponse } from 'next/server';
import { deriveThemes, tagAllInsights } from '@/services/inspiration/themeService';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:themes-rederive');

export async function POST() {
  (async () => { await deriveThemes(); tagAllInsights(); })()
    .catch((e) => log.error({ err: (e as Error).message }, 'rederive failed'));
  return NextResponse.json({ started: true });
}
```

- [ ] **Step 3: Add `theme` filter to the insights route**
In `src/app/api/inspiration/insights/route.ts`, read `theme` alongside the other params:
```ts
  const theme = sp.get('theme');
```
Then in the shared filter block (where `channel`/`category` are added to `conds`), add:
```ts
  if (theme) { conds.push('i.id IN (SELECT insight_id FROM insight_themes WHERE theme_id = ?)'); params.push(Number(theme)); }
```
(The subquery composes with semantic/random/keyset modes since they all build on the shared `conds`/`params`.)

- [ ] **Step 4: Build + functional check**
Run: `cd dashboard && npm run build 2>&1 | grep -E "Compiled successfully|/api/inspiration/themes" | head -4`
Expected: build compiles; `/api/inspiration/themes` + `/api/inspiration/themes/rederive` appear.

Functional (themes list + filter):
```
cd dashboard && npx tsx -e "import('./src/app/api/inspiration/themes/route').then(async m0=>{const m=(m0 as any).default||m0; const r=await m.GET(); const j=await r.json(); console.log('themes:', j.themes.length); console.log(j.themes.slice(0,5).map((t:any)=>t.name+':'+t.insight_count));})"
```
Expected: prints ~15 themes with counts.

- [ ] **Step 5: Commit**
```bash
git add dashboard/src/app/api/inspiration/themes dashboard/src/app/api/inspiration/insights/route.ts
git commit -m "feat(themes): themes API + theme filter on insights"
```

---

## Task 6: Theme dropdown on the wall

**Files:** Modify `src/app/inspiration/page.tsx`

- [ ] **Step 1: Add theme state + fetch**
Near the other `useState`s add:
```ts
  const [theme, setTheme] = useState('');
  const [themes, setThemes] = useState<{ id: number; name: string; insight_count: number }[]>([]);
```
Add a fetch effect near the channels fetch effect:
```ts
  useEffect(() => {
    fetch('/api/inspiration/themes').then((r) => r.json()).then((d) => setThemes(d.themes || [])).catch(() => {});
  }, []);
```
Add `theme` to `buildParams` (and its dependency array):
```ts
    if (theme) params.set('theme', theme);
```
and change the deps to `[statusFilter, sort, q, channel, category, theme]`.

- [ ] **Step 2: Add the dropdown** (in the filter row, right before the channel `<select>`)
```tsx
        <select value={theme} onChange={(e) => setTheme(e.target.value)}
          className="px-2 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-100">
          <option value="">全部主題</option>
          {themes.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.insight_count})</option>)}
        </select>
```

- [ ] **Step 3: Build**
Run: `cd dashboard && npm run build 2>&1 | grep -E "Compiled successfully|Type error" | head -2`
Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Restart + live check**
Run: `launchctl kickstart -k gui/$(id -u)/com.podcast.dashboard`, wait ~12s, then:
```
curl -sk -m 20 https://localhost:3000/api/inspiration/themes | python3 -c "import sys,json;d=json.load(sys.stdin);print('themes:',len(d['themes']));[print(' ',t['name'],t['insight_count']) for t in d['themes'][:8]]"
```
Pick a theme id from the output, then:
```
curl -sk -m 20 "https://localhost:3000/api/inspiration/insights?theme=<ID>" | python3 -c "import sys,json;d=json.load(sys.stdin);print('theme filtered:',len(d['insights']));[print('  •',r['hook'][:46],'['+(r.get('channel_title') or '—')+']') for r in d['insights'][:5]]"
```
Expected: themes list shows ~15 named themes; filtering by one returns on-topic insights **spanning multiple channels** (cross-creator — the point of themes).

- [ ] **Step 5: Commit**
```bash
git add dashboard/src/app/inspiration/page.tsx
git commit -m "feat(themes): theme dropdown on the inspiration wall"
```

---

## Task 7: Final verification

- [ ] **Step 1: Full build** — `cd dashboard && npm run build` → clean.
- [ ] **Step 2: Coverage** — `cd dashboard && npx tsx -e "import { getDb } from './src/db'; const db=getDb(); console.log('themes:', (db.prepare('SELECT COUNT(*) c FROM themes').get()).c, '| tagged insights:', (db.prepare('SELECT COUNT(DISTINCT insight_id) c FROM insight_themes').get()).c, '/', (db.prepare('SELECT COUNT(*) c FROM insights').get()).c);"` → most insights tagged.
- [ ] **Step 3: Cross-creator spot-check** — pick the largest theme, confirm its insights span ≥2 channels (live curl as in Task 6 step 4).
- [ ] **Step 4: Commit** — `git add -A && git commit -m "chore(themes): final verification" || echo "nothing to commit"`

---

## Self-Review Notes (addressed)
- **Spec coverage:** themes+insight_themes tables (T1), derive/assign/tag service (T2), derive+tag corpus (T3), auto-tag on ingest (T4), themes API + theme filter + rederive (T5), theme dropdown (T6), coverage + cross-creator check (T7).
- **Type consistency:** `assignThemes(vec): {themeId,score}[]` + `setInsightThemes(id, assigned)` used identically in pipeline (T4), tagAll (T2), and ingest. The insights route's shared `conds`/`params` block (from A) is where the `theme` subquery is added (T5) — composes with all three query modes.
- **No placeholders:** concrete code + commands + expected output throughout.
- **Known tunable:** `MIN_SCORE=0.30` / `MAX_THEMES_PER=2` — if T3 shows many untagged insights, lower MIN_SCORE; documented, not a blocker. Re-derive is a full refresh (DELETE themes + re-tag).
