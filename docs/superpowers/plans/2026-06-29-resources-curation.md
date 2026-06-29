# `/resources` 學習資源策展 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 dashboard 建一個 `/resources` 學習資源策展系統：每天（或一鍵手動）從 Reddit/GitHub/X 爬「現在正在被討論/正在長」的免費實用資源 → freshness gate 淘汰老而靜 → LLM 評分 → Top N 用 voice writer 生 Threads 草稿 → 寄 email + 上頁 review/編輯/發布。

**Architecture:** 社群（X/Reddit Apify）當「雷達」發現被討論的資源、GitHub API 當「資料庫」補料 + 星速度快照；freshness gate（社群討論 OR 星暴衝，新生 repo 最高分）+ guid 持久去重決定誰浮上來。仿 `services/trends/pipeline.ts` 的 crawl→score→audit 骨架，復用 `voice/writer.ts`（草稿）、`gmail.ts`（email）、`scheduler.ts`（排程）。

**Tech Stack:** Next.js 16 App Router + TypeScript + better-sqlite3 + Apify HTTP + GitHub Search API + OpenRouter LLM。**驗證方式：`npm run build` + `tsx` smoke 腳本**（本 repo 無 jest/vitest；遵 CLAUDE.md）。

**驗證注意事項（每個 phase 都適用）：**
- `npm run build` 只能在 `next dev` 沒在跑時下；若 dashboard launchd 在跑，改用 `npx tsc --noEmit -p tsconfig.json` 驗型別（見 memory: dashboard-dev-https-gotcha）。
- Smoke 腳本放 `dashboard/scripts/`，用 `npx tsx scripts/<name>.ts` 跑。
- 所有門檻走 `settings` 表，key 前綴 `resource_`。

---

## File Structure

**新增 service 模組** `dashboard/src/services/resources/`：
| 檔案 | 責任 |
|------|------|
| `types.ts` | RawResource / EnrichedResource / ScoredResource / ResourceScanResult |
| `crawler.ts` | Reddit(public JSON) + GitHub(Search API) + X(Apify) → RawResource[] |
| `extract.ts` | 從社群貼文文字抽 GitHub repo URL / 外部資源連結 |
| `enrich.ts` | repo → GitHub API 補 star/desc/created_at；星數快照 delta |
| `freshness.ts` | freshnessScore + 硬閘門 + re-surface 判斷 |
| `scorer.ts` | LLM 評分（rubric，沿用 n8n 權重） |
| `draft.ts` | 包 voice/writer.ts 生資源型草稿 |
| `pipeline.ts` | orchestrator（6 stage + scan run audit） |
| `digest.ts` | 組 email HTML + 寄送（gmail.ts） |
| `settings.ts` | 集中讀 `resource_*` 門檻 setting，含預設值 |

**DB**：`dashboard/src/db/index.ts`（safeAlter/safeIndex 區塊新增 3 表）。

**API** `dashboard/src/app/api/resources/`：`scan/route.ts`、`route.ts`（list）、`scans/route.ts`、`[id]/route.ts`、`unread/route.ts`。

**UI** `dashboard/src/app/resources/page.tsx` + `ResourcesClient.tsx`；nav 加入口。

**Scheduler**：`dashboard/src/services/scheduler.ts` 註冊 job。

**Smoke 腳本**：`dashboard/scripts/test-resources-*.ts`。

---

## Task 1: 型別 + DB 表 + settings 預設

**Files:**
- Create: `dashboard/src/services/resources/types.ts`
- Create: `dashboard/src/services/resources/settings.ts`
- Modify: `dashboard/src/db/index.ts`（在既有 trend 表 migration 之後加）

- [ ] **Step 1: 寫 types.ts**

```typescript
// dashboard/src/services/resources/types.ts
export type ContentType = 'github' | 'x' | 'reddit' | 'link';

/** 爬蟲統一輸出。 */
export interface RawResource {
  guid: string;            // github_<owner/repo> | x_<id> | reddit_<id> | link_<hash>
  contentType: ContentType;
  title: string;
  description: string;
  url: string;
  author: string;
  publishedAt?: string;    // ISO
  source: string;          // 哪個 subreddit / X query / github query
  /** 社群互動（X/Reddit 原生資源用）。 */
  engagement?: { likes?: number; comments?: number; reposts?: number; stars?: number };
  /** 從這條社群貼文抽到的 repo 候選（extract 階段填）。 */
  mentionedRepos?: string[];
}

/** enrich 後（GitHub 類補了 star/age/delta）。 */
export interface EnrichedResource extends RawResource {
  stars?: number;
  createdAt?: string;      // repo created_at
  starVelocity?: number;   // stars/day（首見為 undefined）
  socialBuzz: number;      // 合成社群分
  freshnessScore: number;
  freshnessReason: string; // 'star_spike' | 'social_buzz' | 'native_post' | 'youth'
}

/** LLM 評分後。 */
export interface ScoredResource extends EnrichedResource {
  aiScore: number;         // 0-100
  aiReasoning: string;
  aiHighlights: string[];
  aiAngle: string;
  worthSharing: boolean;
}

export interface ResourceScanResult {
  scraped: number;
  belowGate: number;       // freshness gate 淘汰
  deduped: number;         // guid 已 surface 過且無新動能
  scored: number;
  drafted: number;
  recorded: number;
}
```

- [ ] **Step 2: 寫 settings.ts（門檻集中 + 預設）**

```typescript
// dashboard/src/services/resources/settings.ts
import { getDb } from '@/db';

const DEFAULTS = {
  resource_reddit_subs: 'ChatGPTCoding,ClaudeAI,LocalLLaMA,artificial,programming',
  resource_x_queries: 'Claude Code,Codex CLI,MCP server,AI agent skill',
  resource_x_max_items: '20',
  resource_github_queries: 'topic:mcp|topic:ai-agent|claude code in:name,description,readme|codex in:name,description',
  resource_recency_days: '3',
  resource_social_buzz_floor: '120',     // 讚+留言*1.5+轉*2 的合成門檻
  resource_star_velocity_floor: '15',    // stars/day
  resource_youth_window_days: '60',      // repo 年齡加權窗口
  resource_github_pushed_days: '14',     // GitHub 獨立掃 pushed:> 範圍
  resource_github_min_stars: '80',
  resource_top_n: '5',
};

export type ResourceSettingKey = keyof typeof DEFAULTS;

export function rget(key: ResourceSettingKey): string {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? DEFAULTS[key];
}
export function rgetNum(key: ResourceSettingKey): number { return parseFloat(rget(key)); }
export function rgetList(key: ResourceSettingKey, sep = ','): string[] {
  return rget(key).split(sep).map((s) => s.trim()).filter(Boolean);
}
```

- [ ] **Step 3: 在 db/index.ts 加 3 張表**（找到既有 `trend_posts` safeAlter 區塊，緊接其後加）

```typescript
  // --- /resources 學習資源策展 ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS curated_resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guid TEXT UNIQUE NOT NULL,
      content_type TEXT NOT NULL,
      title TEXT,
      description TEXT,
      url TEXT,
      author TEXT,
      published_at TEXT,
      source TEXT,
      stars INTEGER,
      last_stars INTEGER,
      last_stars_at TEXT,
      star_velocity REAL,
      social_buzz REAL DEFAULT 0,
      freshness_score REAL DEFAULT 0,
      freshness_reason TEXT,
      ai_score REAL,
      ai_reasoning TEXT,
      ai_highlights TEXT,
      ai_angle TEXT,
      status TEXT DEFAULT 'new',
      first_seen_at TEXT DEFAULT (datetime('now')),
      last_surfaced_at TEXT,
      scan_run_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS resource_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_guid TEXT NOT NULL,
      draft_text TEXT,
      viral_score REAL,
      status TEXT DEFAULT 'new',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS resource_scan_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT,
      finished_at TEXT,
      duration_ms INTEGER,
      trigger TEXT,
      scraped INTEGER DEFAULT 0,
      below_gate INTEGER DEFAULT 0,
      deduped INTEGER DEFAULT 0,
      scored INTEGER DEFAULT 0,
      drafted INTEGER DEFAULT 0,
      recorded INTEGER DEFAULT 0,
      error TEXT,
      dropped TEXT
    );
  `);
  safeIndex('CREATE UNIQUE INDEX IF NOT EXISTS idx_curated_resources_guid ON curated_resources(guid)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_curated_resources_status ON curated_resources(status)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_resource_drafts_guid ON resource_drafts(resource_guid)');
```

> 注意：`safeIndex` / `db.exec` 用法照搬該檔案既有風格；若該檔用的是 `safeAlter` helper，沿用同名 helper。先讀該檔案確認 helper 名稱再貼。

- [ ] **Step 4: 型別驗證**

Run: `cd dashboard && npx tsc --noEmit -p tsconfig.json`
Expected: 無 error（types.ts / settings.ts 編得過）。

- [ ] **Step 5: 啟動一次確認表建立**

Run: `cd dashboard && npx tsx -e "import('./src/db/index.ts').then(m=>{const db=m.getDb();console.log(db.prepare('SELECT name FROM sqlite_master WHERE type=\"table\" AND name LIKE \"%resource%\"').all())})"`
Expected: 印出 `curated_resources`、`resource_drafts`、`resource_scan_runs`。

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/services/resources/types.ts dashboard/src/services/resources/settings.ts dashboard/src/db/index.ts
git commit -m "feat(resources): types, settings defaults, and 3 DB tables"
```

---

## Task 2: 爬蟲（Reddit + GitHub + X）

**Files:**
- Create: `dashboard/src/services/resources/crawler.ts`
- Create: `dashboard/scripts/test-resources-crawl.ts`

- [ ] **Step 1: 寫 crawler.ts**

三個 source 各一個 async function，回 `RawResource[]`，最後合併。Reddit 走 public JSON（免 OAuth）；GitHub 走 Search API（免 token 也能跑，有 token 更高額度，讀 `process.env.GITHUB_TOKEN` 選用）；X 走 Apify（`APIFY_API_TOKEN`）。

```typescript
// dashboard/src/services/resources/crawler.ts
import { createChildLogger } from '@/lib/logger';
import { rget, rgetList, rgetNum } from './settings';
import type { RawResource } from './types';

const log = createChildLogger('resource-crawler');

function hash(s: string): string {
  let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return Math.abs(h).toString(36);
}

export async function crawlReddit(): Promise<RawResource[]> {
  const subs = rgetList('resource_reddit_subs');
  const out: RawResource[] = [];
  for (const sub of subs) {
    try {
      const res = await fetch(`https://www.reddit.com/r/${sub}/top.json?t=week&limit=25`, {
        headers: { 'User-Agent': 'ailanbao-resources/1.0' },
      });
      if (!res.ok) { log.warn({ sub, status: res.status }, 'reddit fetch failed'); continue; }
      const data = await res.json() as { data?: { children?: Array<{ data: Record<string, unknown> }> } };
      for (const c of data.data?.children ?? []) {
        const d = c.data;
        if (d.stickied) continue;
        out.push({
          guid: `reddit_${d.id}`,
          contentType: 'reddit',
          title: String(d.title ?? ''),
          description: String(d.selftext ?? '').slice(0, 500),
          url: `https://reddit.com${d.permalink}`,
          author: String(d.author ?? ''),
          publishedAt: new Date(Number(d.created_utc ?? 0) * 1000).toISOString(),
          source: `r/${sub}`,
          engagement: { likes: Number(d.score ?? 0), comments: Number(d.num_comments ?? 0) },
        });
      }
    } catch (e) { log.warn({ sub, err: (e as Error).message }, 'reddit error'); }
  }
  return out;
}

export async function crawlGitHub(): Promise<RawResource[]> {
  const pushedDays = rgetNum('resource_github_pushed_days');
  const minStars = rgetNum('resource_github_min_stars');
  const since = new Date(Date.now() - pushedDays * 86_400_000).toISOString().split('T')[0];
  const queries = rget('resource_github_queries').split('|').map((q) => q.trim()).filter(Boolean);
  const token = process.env.GITHUB_TOKEN;
  const out: RawResource[] = [];
  for (const base of queries) {
    const q = `${base} pushed:>${since} stars:>${minStars}`;
    try {
      const res = await fetch(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`,
        { headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'ailanbao-resources',
                     ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
      );
      if (!res.ok) { log.warn({ q, status: res.status }, 'github fetch failed'); continue; }
      const data = await res.json() as { items?: Array<Record<string, unknown>> };
      for (const r of data.items ?? []) {
        out.push({
          guid: `github_${r.full_name}`,
          contentType: 'github',
          title: String(r.full_name ?? ''),
          description: String(r.description ?? '').slice(0, 500),
          url: String(r.html_url ?? ''),
          author: String((r.owner as Record<string, unknown>)?.login ?? ''),
          publishedAt: String(r.created_at ?? ''),
          source: 'github-search',
          engagement: { stars: Number(r.stargazers_count ?? 0) },
        });
      }
    } catch (e) { log.warn({ q, err: (e as Error).message }, 'github error'); }
  }
  return out;
}

export async function crawlX(): Promise<RawResource[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) { log.warn('no APIFY_API_TOKEN, skip X'); return []; }
  const terms = rgetList('resource_x_queries');
  const maxItems = rgetNum('resource_x_max_items');
  const since = new Date(Date.now() - rgetNum('resource_recency_days') * 86_400_000)
    .toISOString().split('T')[0] + '_00:00:00_UTC';
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest/run-sync-get-dataset-items?token=${token}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: 'en', maxItems, queryType: 'Top', min_faves: 60, searchTerms: terms, since }) },
    );
    if (!res.ok) { log.warn({ status: res.status }, 'apify X failed'); return []; }
    const items = await res.json() as Array<Record<string, unknown>>;
    return (Array.isArray(items) ? items : []).map((t) => {
      const id = String(t.url ?? t.twitterUrl ?? '').split('/').pop() ?? hash(JSON.stringify(t));
      const author = t.author as Record<string, unknown> | undefined;
      return {
        guid: `x_${id}`,
        contentType: 'x' as const,
        title: String(t.text ?? '').replace(/\n/g, ' ').slice(0, 80),
        description: String(t.text ?? '').slice(0, 500),
        url: String(t.twitterUrl ?? t.url ?? ''),
        author: String(author?.name ?? author?.userName ?? ''),
        publishedAt: t.createdAt ? new Date(String(t.createdAt)).toISOString() : undefined,
        source: 'x-search',
        engagement: { likes: Number(t.likeCount ?? 0), comments: Number(t.replyCount ?? 0), reposts: Number(t.retweetCount ?? 0) },
      };
    });
  } catch (e) { log.warn({ err: (e as Error).message }, 'apify X error'); return []; }
}

export async function crawlAll(): Promise<RawResource[]> {
  const [reddit, github, x] = await Promise.all([crawlReddit(), crawlGitHub(), crawlX()]);
  log.info({ reddit: reddit.length, github: github.length, x: x.length }, 'crawl done');
  return [...reddit, ...github, ...x];
}
```

- [ ] **Step 2: 寫 smoke 腳本**

```typescript
// dashboard/scripts/test-resources-crawl.ts
import { crawlReddit, crawlGitHub, crawlX } from '../src/services/resources/crawler';
(async () => {
  const reddit = await crawlReddit();
  console.log('reddit:', reddit.length, reddit[0]?.title);
  const github = await crawlGitHub();
  console.log('github:', github.length, github[0]?.guid, github[0]?.engagement?.stars);
  const x = await crawlX();
  console.log('x:', x.length, x[0]?.title);
})();
```

- [ ] **Step 3: 跑 smoke 確認各 source 有回資料**

Run: `cd dashboard && npx tsx scripts/test-resources-crawl.ts`
Expected: reddit > 0、github > 0（X 視 Apify 額度，可能 0 但不報錯）。每筆有 guid/title。

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/services/resources/crawler.ts dashboard/scripts/test-resources-crawl.ts
git commit -m "feat(resources): Reddit/GitHub/X crawlers via public JSON + Apify"
```

---

## Task 3: Extract（從社群貼文抽 repo / 連結）

**Files:**
- Create: `dashboard/src/services/resources/extract.ts`
- Modify: `dashboard/scripts/test-resources-crawl.ts`（加 extract 驗證）

- [ ] **Step 1: 寫 extract.ts**

從 X/Reddit 貼文文字抽 GitHub repo URL（直接可靠），填到 `mentionedRepos`；同時保留貼文本身為 `link`/原生資源候選。第一版只信 URL（見 spec §14）。

```typescript
// dashboard/src/services/resources/extract.ts
import type { RawResource } from './types';

const REPO_RE = /github\.com\/([a-z0-9][\w.-]+\/[a-z0-9][\w.-]+)/gi;

/** 對社群貼文抽出被提到的 repo full_name（去重、去掉常見非 repo path）。 */
export function extractRepos(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(REPO_RE)) {
    const full = m[1].replace(/\.git$/, '').replace(/[).,]+$/, '');
    const [owner, repo] = full.split('/');
    if (!owner || !repo) continue;
    if (['orgs', 'sponsors', 'topics', 'features', 'about'].includes(owner.toLowerCase())) continue;
    out.add(`${owner}/${repo}`);
  }
  return [...out];
}

/** 對每條 social 資源填 mentionedRepos。 */
export function annotateMentions(resources: RawResource[]): RawResource[] {
  return resources.map((r) => {
    if (r.contentType === 'x' || r.contentType === 'reddit') {
      const repos = extractRepos(`${r.description} ${r.url}`);
      if (repos.length) return { ...r, mentionedRepos: repos };
    }
    return r;
  });
}
```

- [ ] **Step 2: 加 extract 驗證到 smoke 腳本尾端**

```typescript
import { extractRepos } from '../src/services/resources/extract';
console.log('extract test:', extractRepos('check out https://github.com/anthropics/claude-code and orgs/foo'));
// 預期: ['anthropics/claude-code']
```

- [ ] **Step 3: 跑驗證**

Run: `cd dashboard && npx tsx scripts/test-resources-crawl.ts`
Expected: `extract test: [ 'anthropics/claude-code' ]`（排除 orgs/foo）。

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/services/resources/extract.ts dashboard/scripts/test-resources-crawl.ts
git commit -m "feat(resources): extract mentioned repos from social posts"
```

---

## Task 4: Enrich（GitHub 補料 + 星數快照 delta）

**Files:**
- Create: `dashboard/src/services/resources/enrich.ts`
- Create: `dashboard/scripts/test-resources-enrich.ts`

- [ ] **Step 1: 寫 enrich.ts**

對 github 類資源 + 從社群抽到的 mentionedRepos，呼叫 GitHub repo API 補 star/created_at；用 `curated_resources` 既有 `last_stars`/`last_stars_at` 算 starVelocity。把社群抽到的 repo 升級成獨立 github RawResource（若尚未在清單）。

```typescript
// dashboard/src/services/resources/enrich.ts
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import type { RawResource, EnrichedResource } from './types';
import { rgetNum } from './settings';

const log = createChildLogger('resource-enrich');

async function fetchRepo(fullName: string): Promise<Record<string, unknown> | null> {
  const token = process.env.GITHUB_TOKEN;
  try {
    const res = await fetch(`https://api.github.com/repos/${fullName}`, {
      headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'ailanbao-resources',
                 ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch (e) { log.warn({ fullName, err: (e as Error).message }, 'repo fetch failed'); return null; }
}

function socialBuzz(r: RawResource): number {
  const e = r.engagement ?? {};
  return (e.likes ?? 0) * 1 + (e.comments ?? 0) * 1.5 + (e.reposts ?? 0) * 2;
}

/** 把社群抽到的 repo 併進清單（升級成 github 候選）。 */
export function expandMentionedRepos(resources: RawResource[]): RawResource[] {
  const have = new Set(resources.map((r) => r.guid));
  const extra: RawResource[] = [];
  for (const r of resources) {
    for (const full of r.mentionedRepos ?? []) {
      const guid = `github_${full}`;
      if (have.has(guid)) continue;
      have.add(guid);
      extra.push({
        guid, contentType: 'github', title: full, description: '', url: `https://github.com/${full}`,
        author: full.split('/')[0], source: `mentioned:${r.contentType}`,
        // 帶上原貼文的社群熱度作為 buzz 訊號
        engagement: { likes: r.engagement?.likes, comments: r.engagement?.comments, reposts: r.engagement?.reposts },
      });
    }
  }
  return [...resources, ...extra];
}

export async function enrichAll(resources: RawResource[]): Promise<EnrichedResource[]> {
  const db = getDb();
  const getPrev = db.prepare('SELECT stars, last_stars_at FROM curated_resources WHERE guid = ?');
  const out: EnrichedResource[] = [];
  for (const r of resources) {
    let stars: number | undefined;
    let createdAt: string | undefined;
    let starVelocity: number | undefined;

    if (r.contentType === 'github') {
      const repo = await fetchRepo(r.title);
      if (repo) {
        stars = Number(repo.stargazers_count ?? 0);
        createdAt = String(repo.created_at ?? '');
        if (!r.description) r.description = String(repo.description ?? '').slice(0, 500);
        const prev = getPrev.get(r.guid) as { stars: number | null; last_stars_at: string | null } | undefined;
        if (prev?.stars != null && prev.last_stars_at) {
          const days = Math.max(0.5, (Date.now() - new Date(prev.last_stars_at).getTime()) / 86_400_000);
          starVelocity = (stars - prev.stars) / days;
        }
      } else {
        stars = r.engagement?.stars;
      }
    }
    out.push({
      ...r, stars, createdAt: createdAt ?? r.publishedAt, starVelocity,
      socialBuzz: socialBuzz(r), freshnessScore: 0, freshnessReason: '',
    });
  }
  log.info({ count: out.length }, 'enrich done');
  return out;
}
```

- [ ] **Step 2: 寫 smoke 腳本**

```typescript
// dashboard/scripts/test-resources-enrich.ts
import { enrichAll, expandMentionedRepos } from '../src/services/resources/enrich';
import type { RawResource } from '../src/services/resources/types';
(async () => {
  const raw: RawResource[] = [
    { guid: 'reddit_x', contentType: 'reddit', title: 't', description: 'see github.com/anthropics/claude-code',
      url: 'https://reddit.com/x', author: 'a', source: 'r/test',
      engagement: { likes: 200, comments: 30 }, mentionedRepos: ['anthropics/claude-code'] },
  ];
  const expanded = expandMentionedRepos(raw);
  console.log('expanded +repo:', expanded.length, expanded.map((r) => r.guid));
  const enriched = await enrichAll(expanded);
  const repo = enriched.find((r) => r.guid === 'github_anthropics/claude-code');
  console.log('repo stars:', repo?.stars, 'createdAt:', repo?.createdAt, 'buzz(reddit):',
    enriched.find((r) => r.guid === 'reddit_x')?.socialBuzz);
})();
```

- [ ] **Step 3: 跑驗證**

Run: `cd dashboard && npx tsx scripts/test-resources-enrich.ts`
Expected: expanded 2 筆（含 github_anthropics/claude-code）；repo stars 為實際數字；reddit buzz = 200 + 30*1.5 = 245。

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/services/resources/enrich.ts dashboard/scripts/test-resources-enrich.ts
git commit -m "feat(resources): GitHub enrich + star-velocity snapshot + mentioned-repo expansion"
```

---

## Task 5: Freshness gate + 去重 / re-surface

**Files:**
- Create: `dashboard/src/services/resources/freshness.ts`
- Create: `dashboard/scripts/test-resources-freshness.ts`

- [ ] **Step 1: 寫 freshness.ts**

```typescript
// dashboard/src/services/resources/freshness.ts
import { getDb } from '@/db';
import { rgetNum } from './settings';
import type { EnrichedResource } from './types';

/** repo 年齡加權：窗口內滿分，之後線性衰減到 0。 */
function youthBonus(createdAt: string | undefined, windowDays: number): number {
  if (!createdAt) return 0;
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
  if (ageDays <= windowDays) return 1 - (ageDays / windowDays) * 0.5; // 0.5~1
  return Math.max(0, 0.5 - (ageDays - windowDays) / (windowDays * 4)); // 之後快速衰減
}

export interface GateResult { passed: EnrichedResource[]; belowGate: number; }

/** 算 freshnessScore + 硬閘門。修改傳入物件的 freshnessScore/Reason。 */
export function applyFreshnessGate(resources: EnrichedResource[]): GateResult {
  const buzzFloor = rgetNum('resource_social_buzz_floor');
  const velFloor = rgetNum('resource_star_velocity_floor');
  const youthWindow = rgetNum('resource_youth_window_days');
  const passed: EnrichedResource[] = [];
  let belowGate = 0;

  for (const r of resources) {
    const youth = r.contentType === 'github' ? youthBonus(r.createdAt, youthWindow) : 0;
    const vel = r.starVelocity ?? 0;

    const socialOk = r.socialBuzz > buzzFloor;
    const starOk = vel > velFloor;
    // 非 github 原生資源：用貼文互動本身（socialBuzz）當門檻
    const nativeOk = r.contentType !== 'github' && r.socialBuzz > buzzFloor;
    // 首見新生 repo（無 velocity 歷史）：youthBonus 高就放行
    const youthOk = r.contentType === 'github' && r.starVelocity === undefined && youth > 0.7;

    if (socialOk || starOk || nativeOk || youthOk) {
      // 分數：星速度 × youth 疊加，社群 buzz 正規化加總
      r.freshnessScore = vel * (1 + youth) + r.socialBuzz / 50 + youth * 20;
      r.freshnessReason = starOk ? 'star_spike' : socialOk ? 'social_buzz' : nativeOk ? 'native_post' : 'youth';
      passed.push(r);
    } else {
      belowGate++;
    }
  }
  passed.sort((a, b) => b.freshnessScore - a.freshnessScore);
  return { passed, belowGate };
}

/** 去重 / re-surface：已 surface 過且無新動能 → 擋掉。回可前進的清單 + deduped 數。 */
export function dedupeForSurface(resources: EnrichedResource[]): { fresh: EnrichedResource[]; deduped: number } {
  const db = getDb();
  const prev = db.prepare('SELECT star_velocity, social_buzz, last_surfaced_at FROM curated_resources WHERE guid = ?');
  const fresh: EnrichedResource[] = [];
  let deduped = 0;
  for (const r of resources) {
    const row = prev.get(r.guid) as { star_velocity: number | null; social_buzz: number | null; last_surfaced_at: string | null } | undefined;
    if (!row || !row.last_surfaced_at) { fresh.push(r); continue; } // 沒 surface 過 → 放行
    // 新動能：星速度明顯放大(>1.5x) 或 社群 buzz 重新越門檻且比上次大
    const velAccel = (r.starVelocity ?? 0) > (row.star_velocity ?? 0) * 1.5 + 5;
    const buzzWave = r.socialBuzz > (row.social_buzz ?? 0) * 1.3;
    if (velAccel || buzzWave) { fresh.push(r); } else { deduped++; }
  }
  return { fresh, deduped };
}
```

- [ ] **Step 2: 寫 smoke 腳本（純函式，不碰網路）**

```typescript
// dashboard/scripts/test-resources-freshness.ts
import { applyFreshnessGate } from '../src/services/resources/freshness';
import type { EnrichedResource } from '../src/services/resources/types';
const base = { title: 't', description: '', url: 'u', author: 'a', source: 's', socialBuzz: 0, freshnessScore: 0, freshnessReason: '' };
const items: EnrichedResource[] = [
  { ...base, guid: 'github_new', contentType: 'github', createdAt: new Date(Date.now() - 5 * 86400000).toISOString(), starVelocity: undefined }, // 新生 → youthOk
  { ...base, guid: 'github_old_flat', contentType: 'github', createdAt: new Date(Date.now() - 400 * 86400000).toISOString(), starVelocity: 1 }, // 老而平 → 淘汰
  { ...base, guid: 'reddit_hot', contentType: 'reddit', socialBuzz: 300 }, // 社群熱 → nativeOk
];
const r = applyFreshnessGate(items);
console.log('passed:', r.passed.map((p) => `${p.guid}:${p.freshnessReason}`), 'belowGate:', r.belowGate);
// 預期: passed 含 github_new(youth) 與 reddit_hot(native_post)；belowGate=1（github_old_flat）
```

- [ ] **Step 3: 跑驗證**

Run: `cd dashboard && npx tsx scripts/test-resources-freshness.ts`
Expected: `passed: [ 'github_new:youth', 'reddit_hot:native_post' ] belowGate: 1`（old_flat 被淘汰）。

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/services/resources/freshness.ts dashboard/scripts/test-resources-freshness.ts
git commit -m "feat(resources): freshness gate (social OR star-spike, youth-weighted) + re-surface dedup"
```

---

## Task 6: LLM 評分

**Files:**
- Create: `dashboard/src/services/resources/scorer.ts`
- Create: `dashboard/scripts/test-resources-score.ts`

- [ ] **Step 1: 寫 scorer.ts**（沿用 n8n rubric；用 `llmService`，便宜模型）

```typescript
// dashboard/src/services/resources/scorer.ts
import { getLLMService } from '@/services/llmService';
import { createChildLogger } from '@/lib/logger';
import type { EnrichedResource, ScoredResource } from './types';

const log = createChildLogger('resource-scorer');

const SYSTEM = `你在為「AI 懶人報」篩選值得分享給觀眾的實用資源。觀眾＝正在用 Claude Code / Codex / AI coding agent 的開發者與獨立創作者。對內容評分，四維度加總 100：
1.【實用性／可立即上手】35：能直接接進 workflow、附用法、省時間給高分；純概念低分。
2.【與 AI coding 工作流契合度】30：能跟 Claude Code/Codex/Cursor 直接搭配給高分。
3.【新穎性／隱藏寶藏】20：少人知道的 hidden gem、剛冒出的好工具給高分；老生常談低分。
4.【收藏／話題價值】15：清單型、懶人包、值得收藏給高分。
worthSharing：只有「對 Claude Code/Codex 使用者真的有用」才 true；純新聞/八卦/無法上手的 demo 一律 false。
嚴格輸出 JSON，不要 markdown fence：
{"scores":{"usefulness":0,"fit":0,"novelty":0,"virality":0,"total":0},"reasoning":"具體理由","highlights":["亮點1","亮點2"],"postAngle":"建議切入角度","worthSharing":true}`;

export async function scoreResource(r: EnrichedResource): Promise<ScoredResource> {
  const user = `類型:${r.contentType}\n標題:${r.title}\n描述:${r.description}\n作者:${r.author}\nURL:${r.url}\n` +
    `互動:${JSON.stringify(r.engagement ?? {})}\n星數:${r.stars ?? '-'} 星速度:${r.starVelocity?.toFixed(1) ?? '-'}/day ` +
    `新鮮原因:${r.freshnessReason}`;
  const res = await getLLMService().call({
    stage: 'resource_score',
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
    options: { temperature: 0.3, maxTokens: 800,
      models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3.5-flash'], retryCount: 2, timeoutMs: 30_000 },
  });
  let parsed: Record<string, unknown> = {};
  if (res.success && res.content) {
    const m = res.content.match(/\{[\s\S]*\}/);
    try { parsed = JSON.parse(m ? m[0] : res.content); } catch { /* leave empty */ }
  }
  const scores = (parsed.scores ?? {}) as Record<string, number>;
  return {
    ...r,
    aiScore: Number(scores.total ?? 0),
    aiReasoning: String(parsed.reasoning ?? ''),
    aiHighlights: Array.isArray(parsed.highlights) ? parsed.highlights.map(String) : [],
    aiAngle: String(parsed.postAngle ?? ''),
    worthSharing: parsed.worthSharing === true,
  };
}

/** 併發評分（限流 4）。 */
export async function scoreAll(resources: EnrichedResource[]): Promise<ScoredResource[]> {
  const out: ScoredResource[] = [];
  for (let i = 0; i < resources.length; i += 4) {
    const batch = await Promise.all(resources.slice(i, i + 4).map((r) => scoreResource(r)));
    out.push(...batch);
  }
  log.info({ scored: out.length, worthy: out.filter((r) => r.worthSharing).length }, 'score done');
  return out;
}
```

- [ ] **Step 2: 寫 smoke 腳本**

```typescript
// dashboard/scripts/test-resources-score.ts
import { scoreResource } from '../src/services/resources/scorer';
import type { EnrichedResource } from '../src/services/resources/types';
(async () => {
  const r: EnrichedResource = {
    guid: 'github_anthropics/claude-code', contentType: 'github', title: 'anthropics/claude-code',
    description: 'Claude Code CLI — agentic coding tool', url: 'https://github.com/anthropics/claude-code',
    author: 'anthropics', source: 's', stars: 9000, starVelocity: 120, socialBuzz: 0,
    freshnessScore: 100, freshnessReason: 'star_spike',
  };
  const scored = await scoreResource(r);
  console.log('score:', scored.aiScore, 'worthy:', scored.worthSharing, 'angle:', scored.aiAngle);
})();
```

- [ ] **Step 3: 跑驗證**

Run: `cd dashboard && npx tsx scripts/test-resources-score.ts`
Expected: aiScore 為合理數字（claude-code 應 worthy=true），angle 非空。

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/services/resources/scorer.ts dashboard/scripts/test-resources-score.ts
git commit -m "feat(resources): LLM scoring with n8n rubric"
```

---

## Task 7: 草稿生成（包 voice/writer.ts）

**Files:**
- Create: `dashboard/src/services/resources/draft.ts`
- Create: `dashboard/scripts/test-resources-draft.ts`

- [ ] **Step 1: 先讀 voice/writer.ts 確認匯出簽名**

Run: `cd dashboard && grep -nE "export (async )?function|writeBestOfN|export interface" src/services/voice/writer.ts | head`
Expected: 找到 `writeBestOfN`（或等價）的簽名 —— 確認它接什麼參數、回什麼（含 viral score）。下一步依**實際簽名**調整。

- [ ] **Step 2: 寫 draft.ts**（依 Step 1 的實際簽名；以下為預期形狀，若 writer 簽名不同則對齊）

```typescript
// dashboard/src/services/resources/draft.ts
import { writeBestOfN } from '@/services/voice/writer';
import { createChildLogger } from '@/lib/logger';
import type { ScoredResource } from './types';

const log = createChildLogger('resource-draft');

export interface ResourceDraft { guid: string; draftText: string; viralScore: number; }

/** 把一個資源寫成 Threads 草稿，語氣＝懶人包/工具清單。best-of-N 挑最爆。 */
export async function draftResource(r: ScoredResource): Promise<ResourceDraft> {
  const brief = `把這個資源寫成一則「實用資源/工具懶人包」風格的 Threads 貼文（繁中、個人口吻、附來源連結）。
資源：${r.title}
這是什麼：${r.description}
為什麼現在值得看：${r.freshnessReason === 'star_spike' ? '最近星數暴衝' : r.freshnessReason === 'social_buzz' || r.freshnessReason === 'native_post' ? '社群正在熱議' : '剛上線的新工具'}
亮點：${r.aiHighlights.join('、')}
建議角度：${r.aiAngle}
來源：${r.url}`;
  const result = await writeBestOfN({ topic: brief, bestOf: 5 });
  // 對齊 writer 回傳結構：取最高分草稿 + viral_prob
  const best = (result as { text: string; viralProb?: number });
  log.info({ guid: r.guid, viral: best.viralProb }, 'draft done');
  return { guid: r.guid, draftText: best.text, viralScore: best.viralProb ?? 0 };
}
```

> ⚠️ 若 `writeBestOfN` 的參數/回傳名與此不同（Step 1 會看到），**以實際為準**改 `brief` 包裝與 `best` 解構。語氣調整透過 brief 文字，不改 writer 內部。

- [ ] **Step 3: 寫 smoke 腳本**

```typescript
// dashboard/scripts/test-resources-draft.ts
import { draftResource } from '../src/services/resources/draft';
import type { ScoredResource } from '../src/services/resources/types';
(async () => {
  const r: ScoredResource = {
    guid: 'github_anthropics/claude-code', contentType: 'github', title: 'anthropics/claude-code',
    description: 'Claude Code CLI', url: 'https://github.com/anthropics/claude-code', author: 'anthropics', source: 's',
    starVelocity: 120, socialBuzz: 0, freshnessScore: 100, freshnessReason: 'star_spike',
    aiScore: 90, aiReasoning: '', aiHighlights: ['CLI agentic coding', '可接 MCP'], aiAngle: '工具開箱', worthSharing: true,
  };
  const d = await draftResource(r);
  console.log('draft viral:', d.viralScore, '\n---\n', d.draftText);
})();
```

- [ ] **Step 4: 跑驗證**

Run: `cd dashboard && npx tsx scripts/test-resources-draft.ts`
Expected: 印出一則繁中草稿，含來源 URL；viral 分數有值（predictor 離線時為 0 但不報錯）。

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/services/resources/draft.ts dashboard/scripts/test-resources-draft.ts
git commit -m "feat(resources): draft generation via voice writer (best-of-N)"
```

---

## Task 8: Pipeline orchestrator + audit + 落 DB

**Files:**
- Create: `dashboard/src/services/resources/pipeline.ts`
- Create: `dashboard/scripts/test-resources-pipeline.ts`

- [ ] **Step 1: 寫 pipeline.ts**

串 6 stage、開 `resource_scan_runs` audit row、把 Top N + 草稿 upsert 進 DB、更新星數快照與 `last_surfaced_at`。

```typescript
// dashboard/src/services/resources/pipeline.ts
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { crawlAll } from './crawler';
import { annotateMentions } from './extract';
import { enrichAll, expandMentionedRepos } from './enrich';
import { applyFreshnessGate, dedupeForSurface } from './freshness';
import { scoreAll } from './scorer';
import { draftResource } from './draft';
import { sendResourceDigest } from './digest';
import { rgetNum } from './settings';
import type { ResourceScanResult, ScoredResource } from './types';

const log = createChildLogger('resource-pipeline');

export async function runResourceScan(opts: { trigger?: string } = {}): Promise<ResourceScanResult> {
  const db = getDb();
  const t0 = Date.now();
  const runId = Number(db.prepare('INSERT INTO resource_scan_runs (started_at, trigger) VALUES (?, ?)')
    .run(new Date().toISOString(), opts.trigger ?? null).lastInsertRowid);
  const result: ResourceScanResult = { scraped: 0, belowGate: 0, deduped: 0, scored: 0, drafted: 0, recorded: 0 };

  try {
    const raw = annotateMentions(await crawlAll());
    result.scraped = raw.length;
    const enriched = await enrichAll(expandMentionedRepos(raw));
    const gate = applyFreshnessGate(enriched);
    result.belowGate = gate.belowGate;
    const { fresh, deduped } = dedupeForSurface(gate.passed);
    result.deduped = deduped;

    const scored = await scoreAll(fresh);
    result.scored = scored.length;
    const worthy = scored.filter((r) => r.worthSharing).sort((a, b) => b.aiScore - a.aiScore);
    const topN = worthy.slice(0, rgetNum('resource_top_n'));

    // 生草稿（Top N）
    const drafts: Array<{ r: ScoredResource; text: string; viral: number }> = [];
    for (const r of topN) {
      try { const d = await draftResource(r); drafts.push({ r, text: d.draftText, viral: d.viralScore }); result.drafted++; }
      catch (e) { log.warn({ guid: r.guid, err: (e as Error).message }, 'draft failed'); }
    }

    // 落 DB：upsert 資源 + 星數快照 + 草稿 + last_surfaced_at
    const upsert = db.prepare(`
      INSERT INTO curated_resources (guid, content_type, title, description, url, author, published_at, source,
        stars, last_stars, last_stars_at, star_velocity, social_buzz, freshness_score, freshness_reason,
        ai_score, ai_reasoning, ai_highlights, ai_angle, status, last_surfaced_at, scan_run_id)
      VALUES (@guid,@content_type,@title,@description,@url,@author,@published_at,@source,
        @stars,@stars,datetime('now'),@star_velocity,@social_buzz,@freshness_score,@freshness_reason,
        @ai_score,@ai_reasoning,@ai_highlights,@ai_angle,'surfaced',datetime('now'),@scan_run_id)
      ON CONFLICT(guid) DO UPDATE SET stars=@stars, last_stars=curated_resources.stars, last_stars_at=datetime('now'),
        star_velocity=@star_velocity, social_buzz=@social_buzz, freshness_score=@freshness_score,
        freshness_reason=@freshness_reason, ai_score=@ai_score, ai_reasoning=@ai_reasoning,
        ai_highlights=@ai_highlights, ai_angle=@ai_angle, status='surfaced', last_surfaced_at=datetime('now'),
        scan_run_id=@scan_run_id
    `);
    const insDraft = db.prepare('INSERT INTO resource_drafts (resource_guid, draft_text, viral_score) VALUES (?, ?, ?)');
    const tx = db.transaction(() => {
      for (const { r, text, viral } of drafts) {
        upsert.run({
          guid: r.guid, content_type: r.contentType, title: r.title, description: r.description, url: r.url,
          author: r.author, published_at: r.publishedAt ?? null, source: r.source, stars: r.stars ?? null,
          star_velocity: r.starVelocity ?? null, social_buzz: r.socialBuzz, freshness_score: r.freshnessScore,
          freshness_reason: r.freshnessReason, ai_score: r.aiScore, ai_reasoning: r.aiReasoning,
          ai_highlights: JSON.stringify(r.aiHighlights), ai_angle: r.aiAngle, scan_run_id: runId,
        });
        insDraft.run(r.guid, text, viral);
        result.recorded++;
      }
    });
    tx();

    if (drafts.length) await sendResourceDigest(drafts.map(({ r, text, viral }) => ({ r, text, viral })));

    db.prepare(`UPDATE resource_scan_runs SET finished_at=?, duration_ms=?, scraped=?, below_gate=?, deduped=?, scored=?, drafted=?, recorded=? WHERE id=?`)
      .run(new Date().toISOString(), Date.now() - t0, result.scraped, result.belowGate, result.deduped, result.scored, result.drafted, result.recorded, runId);
    db.prepare('DELETE FROM resource_scan_runs WHERE id NOT IN (SELECT id FROM resource_scan_runs ORDER BY id DESC LIMIT 60)').run();
    log.info({ runId, ...result }, 'resource scan complete');
    return result;
  } catch (e) {
    db.prepare('UPDATE resource_scan_runs SET finished_at=?, duration_ms=?, error=? WHERE id=?')
      .run(new Date().toISOString(), Date.now() - t0, (e as Error).message, runId);
    log.error({ runId, err: (e as Error).message }, 'resource scan failed');
    throw e;
  }
}
```

- [ ] **Step 2: 寫 smoke 腳本（完整一輪）**

```typescript
// dashboard/scripts/test-resources-pipeline.ts
import { runResourceScan } from '../src/services/resources/pipeline';
(async () => {
  const r = await runResourceScan({ trigger: 'smoke' });
  console.log('RESULT:', JSON.stringify(r, null, 2));
})();
```

- [ ] **Step 3: 跑完整 pipeline（真實爬 + 評分 + 草稿 + email）**

Run: `cd dashboard && npx tsx scripts/test-resources-pipeline.ts`
Expected: 印出 funnel（scraped > 0、belowGate 有數字、recorded ≤ topN）；DB `curated_resources`/`resource_drafts` 有資料；收到一封 email（若 worthy ≥ 1）。

- [ ] **Step 4: 確認 DB 落地**

Run: `cd dashboard && npx tsx -e "import('./src/db/index.ts').then(m=>{const db=m.getDb();console.log('resources:',db.prepare('SELECT count(*) c FROM curated_resources').get());console.log('drafts:',db.prepare('SELECT count(*) c FROM resource_drafts').get())})"`
Expected: 兩個 count 都 > 0。

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/services/resources/pipeline.ts dashboard/scripts/test-resources-pipeline.ts
git commit -m "feat(resources): pipeline orchestrator with audit + upsert + draft persistence"
```

---

## Task 9: Email digest

**Files:**
- Create: `dashboard/src/services/resources/digest.ts`
- 先讀 `dashboard/src/services/gmail.ts` 確認寄信函式簽名

- [ ] **Step 1: 讀 gmail.ts 簽名**

Run: `cd dashboard && grep -nE "export (async )?function|sendMail|sendEmail|to:|subject" src/services/gmail.ts | head`
Expected: 找到寄信函式（如 `sendEmail({to,subject,html})`）。下一步依實際簽名。

- [ ] **Step 2: 寫 digest.ts**（依實際 gmail 簽名；以下為預期形狀）

```typescript
// dashboard/src/services/resources/digest.ts
import { sendEmail } from '@/services/gmail';
import { createChildLogger } from '@/lib/logger';
import type { ScoredResource } from './types';

const log = createChildLogger('resource-digest');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function sendResourceDigest(items: Array<{ r: ScoredResource; text: string; viral: number }>): Promise<void> {
  const to = process.env.RECIPIENT_EMAIL;
  if (!to) { log.warn('no RECIPIENT_EMAIL, skip digest'); return; }
  const date = new Date().toISOString().split('T')[0];
  const cards = items.map(({ r, text, viral }, i) => {
    const why = r.freshnessReason === 'star_spike' ? `⭐ 星速度 ${r.starVelocity?.toFixed(0)}/day`
      : r.freshnessReason === 'youth' ? '🆕 剛上線新工具'
      : '🔥 社群熱議';
    return `<div style="border:1px solid #e0e0e0;border-radius:12px;padding:18px;margin:16px 0;background:#fafafa">
      <h3 style="margin:0 0 6px">#${i + 1} ${esc(r.title)}</h3>
      <p style="margin:4px 0;color:#555">📊 ${r.aiScore}/100 ｜ ${r.contentType} ｜ ${why} ｜ 爆文分 ${(viral * 100).toFixed(0)}</p>
      <p style="margin:4px 0">✨ ${esc(r.aiHighlights.join('、'))}</p>
      <div style="background:#fff;padding:14px;border-radius:8px;border-left:4px solid #6366f1;white-space:pre-wrap">${esc(text)}</div>
      <p>🔗 <a href="${esc(r.url)}">${esc(r.url)}</a></p>
    </div>`;
  }).join('');
  await sendEmail({
    to, subject: `📚 學習資源每日精選 — ${items.length} 篇待 review (${date})`,
    html: `<h2>📚 學習資源每日精選</h2><p style="color:#888">${date}｜在 /resources 頁可編輯/發布</p>${cards}`,
  });
  log.info({ count: items.length }, 'resource digest sent');
}
```

> ⚠️ `sendEmail` 簽名以 Step 1 實際為準。

- [ ] **Step 3: 驗證（pipeline smoke 已會觸發；單獨驗一次）**

Run: `cd dashboard && npx tsx -e "import('./src/services/resources/digest').then(async m=>{await m.sendResourceDigest([{r:{guid:'g',contentType:'github',title:'test/repo',description:'d',url:'https://github.com/test/repo',author:'t',source:'s',socialBuzz:0,freshnessScore:1,freshnessReason:'star_spike',starVelocity:99,aiScore:88,aiReasoning:'',aiHighlights:['a','b'],aiAngle:'',worthSharing:true},text:'測試草稿',viral:0.5}]);console.log('sent')})"`
Expected: 印 `sent`；信箱收到一封含卡片的 email。

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/services/resources/digest.ts
git commit -m "feat(resources): daily email digest via gmail"
```

---

## Task 10: API routes

**Files:**
- Create: `dashboard/src/app/api/resources/scan/route.ts`
- Create: `dashboard/src/app/api/resources/route.ts`
- Create: `dashboard/src/app/api/resources/scans/route.ts`
- Create: `dashboard/src/app/api/resources/[id]/route.ts`
- Create: `dashboard/src/app/api/resources/unread/route.ts`

- [ ] **Step 1: 先讀一個既有 trends route 對齊風格**

Run: `cd dashboard && sed -n '1,40p' src/app/api/trends/scan/route.ts`
Expected: 看到 fire-and-forget 寫法（`runTrendScan()` 不 await + 立即回 `NextResponse.json`）。下面照搬。

- [ ] **Step 2: 寫 scan route（fire-and-forget 一鍵觸發）**

```typescript
// dashboard/src/app/api/resources/scan/route.ts
import { NextResponse } from 'next/server';
import { runResourceScan } from '@/services/resources/pipeline';
export async function POST() {
  runResourceScan({ trigger: 'manual' }).catch((e) => console.error('resource scan failed', e));
  return NextResponse.json({ ok: true, started: true });
}
```

- [ ] **Step 3: 寫 list route（review 頁用）**

```typescript
// dashboard/src/app/api/resources/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
export async function GET() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT r.*, d.id AS draft_id, d.draft_text, d.viral_score, d.status AS draft_status
    FROM curated_resources r
    LEFT JOIN resource_drafts d ON d.resource_guid = r.guid
    WHERE r.status != 'dismissed'
    ORDER BY r.last_surfaced_at DESC, d.id DESC LIMIT 100
  `).all();
  return NextResponse.json({ resources: rows });
}
```

- [ ] **Step 4: 寫 scans route（funnel 狀態列）**

```typescript
// dashboard/src/app/api/resources/scans/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
export async function GET() {
  const db = getDb();
  const runs = db.prepare('SELECT * FROM resource_scan_runs ORDER BY id DESC LIMIT 10').all();
  return NextResponse.json({ runs });
}
```

- [ ] **Step 5: 寫 [id] route（編輯草稿 / dismiss）**

```typescript
// dashboard/src/app/api/resources/[id]/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json() as { draftText?: string; action?: 'dismiss' };
  const db = getDb();
  if (body.action === 'dismiss') {
    db.prepare('UPDATE resource_drafts SET status = ? WHERE id = ?').run('dismissed', id);
    return NextResponse.json({ ok: true });
  }
  if (typeof body.draftText === 'string') {
    db.prepare('UPDATE resource_drafts SET draft_text = ? WHERE id = ?').run(body.draftText, id);
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: 寫 unread route（nav 紅點）**

```typescript
// dashboard/src/app/api/resources/unread/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
export async function GET() {
  const db = getDb();
  const row = db.prepare("SELECT count(*) AS c FROM resource_drafts WHERE status = 'new'").get() as { c: number };
  return NextResponse.json({ unread: row.c });
}
```

- [ ] **Step 7: 型別驗證**

Run: `cd dashboard && npx tsc --noEmit -p tsconfig.json`
Expected: 無 error。

- [ ] **Step 8: 觸發 scan API（dashboard 在跑時）**

Run: `curl -k -s -X POST https://localhost:3000/api/resources/scan`
Expected: `{"ok":true,"started":true}`（背景跑；幾分鐘後 `curl -k https://localhost:3000/api/resources` 有資料）。

- [ ] **Step 9: Commit**

```bash
git add dashboard/src/app/api/resources
git commit -m "feat(resources): API routes (scan/list/scans/patch/unread)"
```

---

## Task 11: `/resources` UI 頁面 + nav 紅點

**Files:**
- Create: `dashboard/src/app/resources/page.tsx`
- Create: `dashboard/src/app/resources/ResourcesClient.tsx`
- Modify: nav 元件（先 grep 定位）

- [ ] **Step 1: 定位 nav 與既有 PageHeader/卡片風格**

Run: `cd dashboard && grep -rln "trends\|靈感庫\|PageHeader" src/app/layout.tsx src/components 2>/dev/null | head` 並 `grep -rn "nav:unread-seen\|/api/trends/niche/unread" src | head`
Expected: 找到 nav 清單檔 + unread 紅點機制 + `PageHeader`（memory: ui-pageheader-convention）。下面沿用。

- [ ] **Step 2: 寫 page.tsx（server wrapper）**

```tsx
// dashboard/src/app/resources/page.tsx
import ResourcesClient from './ResourcesClient';
export const dynamic = 'force-dynamic';
export default function ResourcesPage() {
  return <ResourcesClient />;
}
```

- [ ] **Step 3: 寫 ResourcesClient.tsx**

卡片列表 + 頂部「▶️ 立即執行」+ funnel 狀態 + 每卡：資源 metadata（star/delta/年齡/why-hot badge）、可編輯草稿、`📋 複製`、`🧵 去 Threads 發佈`（深連 `https://www.threads.net/intent/post?text=<encoded>`）、`❌ 不要`。用 `PageHeader`（標題「學習資源」與 nav 一致）。手機優先（memory: mobile-usage-priority）。

```tsx
// dashboard/src/app/resources/ResourcesClient.tsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader'; // 以 Step 1 實際路徑為準

interface Row {
  id: number; guid: string; content_type: string; title: string; description: string; url: string;
  stars: number | null; star_velocity: number | null; published_at: string | null; freshness_reason: string;
  ai_score: number | null; ai_highlights: string | null; draft_id: number | null; draft_text: string | null; viral_score: number | null;
}

function whyHot(r: Row): string {
  if (r.freshness_reason === 'star_spike') return `⭐ ${r.star_velocity?.toFixed(0)}/day`;
  if (r.freshness_reason === 'youth') return '🆕 新工具';
  return '🔥 社群熱議';
}
function repoAge(iso: string | null): string {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d < 31 ? `${d} 天` : `${Math.floor(d / 30)} 個月`;
}

export default function ResourcesClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [runs, setRuns] = useState<Array<Record<string, number | string>>>([]);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([fetch('/api/resources'), fetch('/api/resources/scans')]);
    setRows((await a.json()).resources ?? []);
    setRuns((await b.json()).runs ?? []);
  }, []);
  useEffect(() => { load(); window.dispatchEvent(new Event('nav:unread-seen')); }, [load]);

  const runScan = async () => {
    setRunning(true);
    await fetch('/api/resources/scan', { method: 'POST' });
    setTimeout(() => { load(); setRunning(false); }, 4000); // 背景跑；稍後刷新
  };
  const saveDraft = async (id: number, text: string) =>
    fetch(`/api/resources/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftText: text }) });
  const dismiss = async (id: number) => { await fetch(`/api/resources/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'dismiss' }) }); load(); };

  const last = runs[0];
  return (
    <div className="max-w-3xl mx-auto p-4">
      <PageHeader title="學習資源" />
      <div className="flex items-center gap-3 my-3">
        <button onClick={runScan} disabled={running} className="px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50">
          {running ? '執行中…' : '▶️ 立即執行'}
        </button>
        {last && <span className="text-sm text-gray-500">上次：爬 {last.scraped}→閘門淘汰 {last.below_gate}→收錄 {last.recorded}</span>}
      </div>
      {rows.map((r) => (
        <div key={`${r.guid}-${r.draft_id}`} className="border rounded-xl p-4 my-3 bg-white">
          <div className="flex justify-between items-start">
            <h3 className="font-semibold">{r.title}</h3>
            <span className="text-xs px-2 py-0.5 rounded bg-gray-100">{r.content_type}</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {whyHot(r)} {r.stars != null && `｜⭐ ${r.stars}`} {r.published_at && `｜${repoAge(r.published_at)}`}
            {r.ai_score != null && `｜評分 ${r.ai_score}/100`}
          </p>
          {r.draft_id && (
            <>
              <textarea defaultValue={r.draft_text ?? ''} onBlur={(e) => saveDraft(r.draft_id!, e.target.value)}
                className="w-full mt-2 p-2 border rounded text-sm" rows={6} />
              <div className="flex gap-2 mt-2">
                <button onClick={() => navigator.clipboard.writeText(r.draft_text ?? '')} className="px-3 py-1 text-sm border rounded">📋 複製</button>
                <a href={`https://www.threads.net/intent/post?text=${encodeURIComponent(r.draft_text ?? '')}`} target="_blank" rel="noreferrer"
                  className="px-3 py-1 text-sm bg-black text-white rounded">🧵 去 Threads 發佈</a>
                <button onClick={() => dismiss(r.draft_id!)} className="px-3 py-1 text-sm text-red-500 border rounded ml-auto">❌ 不要</button>
              </div>
            </>
          )}
          <a href={r.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-500 mt-2 inline-block">🔗 來源</a>
        </div>
      ))}
      {!rows.length && <p className="text-gray-400 text-center py-10">尚無資源，按「立即執行」跑一輪。</p>}
    </div>
  );
}
```

- [ ] **Step 4: 把 `/resources` 加進 nav**（依 Step 1 找到的 nav 檔；加一筆 `{ href: '/resources', label: '學習資源' }` + unread 紅點接 `/api/resources/unread`，比照 trends/inspiration）。

- [ ] **Step 5: 型別 + build 驗證**

Run: `cd dashboard && npx tsc --noEmit -p tsconfig.json`
Expected: 無 error。

- [ ] **Step 6: 真機/瀏覽器驗證**

開 `https://localhost:3000/resources` → 按「▶️ 立即執行」→ 數分鐘後刷新看到卡片；「📋 複製」可複製；「🧵 去 Threads」開 Threads compose 帶入草稿；「❌ 不要」卡片消失。手機寬度（375px）排版正常。

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/app/resources <nav 檔>
git commit -m "feat(resources): /resources review page + manual run + Threads deep-link + nav red dot"
```

---

## Task 12: 排程註冊 + 端到端驗收

**Files:**
- Modify: `dashboard/src/services/scheduler.ts`

- [ ] **Step 1: 讀 scheduler.ts 既有 job 註冊樣式**

Run: `cd dashboard && grep -nE "cron|schedule|registerJob|node-cron|runTrendScan" src/services/scheduler.ts | head`
Expected: 看到既有 job 怎麼註冊（cron 字串 + handler）。

- [ ] **Step 2: 加每天一個 resource scan job**（照既有樣式，cron 每天 08:00；handler 呼叫 `runResourceScan({ trigger: 'cron' })`）

```typescript
// 在 scheduler.ts 既有 job 註冊區，仿照 trend job 加：
import { runResourceScan } from '@/services/resources/pipeline';
// ...
cron.schedule('0 8 * * *', () => {
  runResourceScan({ trigger: 'cron' }).catch((e) => log.error({ err: (e as Error).message }, 'resource cron failed'));
});
```

> cron 函式名/log 物件以 scheduler.ts 既有為準。

- [ ] **Step 3: build 驗證**

Run: `cd dashboard && npx tsc --noEmit -p tsconfig.json`
Expected: 無 error。

- [ ] **Step 4: 端到端驗收（完整一輪）**

Run: `cd dashboard && npx tsx scripts/test-resources-pipeline.ts`
Expected 全部成立：
- funnel：scraped > 0、belowGate 有把老/靜的擋掉、recorded ≤ top_n。
- DB：`curated_resources` + `resource_drafts` 有資料。
- email：收到 digest。
- `/resources` 頁顯示卡片、可編輯/複製/深連 Threads/dismiss。
- **連跑第二次**：已 surface 過且無新動能的資源不重複（deduped > 0）。

- [ ] **Step 5: 最終 build（dashboard 停掉 next dev 後）**

Run: `cd dashboard && npm run build`
Expected: build 成功（若 launchd dev server 在跑，先 `launchctl stop com.podcast.dashboard` 再 build，完再 start）。

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/services/scheduler.ts
git commit -m "feat(resources): register daily cron + end-to-end verified"
```

---

## Self-Review（plan vs spec 對照）

- **§2 架構翻轉**：Task 2（crawlers）+ Task 3（extract）+ Task 4（expandMentionedRepos）涵蓋「社群當雷達、GitHub 補料、資源不限 repo」。✅
- **§3 通用資源模型**：Task 1 types `ContentType` + 表欄位。✅
- **§4 freshness gate**：Task 5 `applyFreshnessGate`（social OR star-spike OR native OR youth）。✅
- **§5 去重 re-surface**：Task 5 `dedupeForSurface`（velAccel / buzzWave）。✅
- **§6 pipeline 6 stage + audit**：Task 8。✅
- **§7 voice writer 草稿**：Task 7。✅
- **§8 review UI + 一鍵跑 + 深連/複製 + 紅點**：Task 10（scan API）+ Task 11。✅
- **§9 email digest**：Task 9。✅
- **§10 排程**：Task 12。✅
- **§11 三張表**：Task 1。✅
- **§13 不做**：無 YouTube、無 Threads API 自動發（用 intent 深連）、無 Telegram、無向量去重。✅

**Placeholder scan**：每個會改 code 的 step 都有完整 code；三處標「以實際簽名為準」（voice/writer、gmail、scheduler、nav）都附了先 grep 確認的前置 step，非 placeholder 而是對齊既有介面的必要動作。

**型別一致性**：`RawResource`→`EnrichedResource`→`ScoredResource` 漸進擴充，欄位名跨 task 一致（guid/contentType/starVelocity/socialBuzz/freshnessReason/aiScore）。pipeline upsert 欄位對齊 Task 1 表 schema。

**已知對齊風險（執行時必查）**：`writeBestOfN`、`sendEmail`、scheduler cron helper、nav 檔路徑、`PageHeader` import 路徑 —— 各 task 已放 grep step 先確認再寫。
