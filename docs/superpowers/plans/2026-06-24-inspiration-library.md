# 靈感庫 (Inspiration Library) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an inspiration library where Tommy pastes a YouTube / Apple Podcast link (or text), AI extracts shareable "insight" cards into a scrollable, searchable bank, and any card can be remixed (with his own experience) into a Threads post in his brand voice.

**Architecture:** Mirror the existing `trends` feature's `source → insights → drafts` shape. A reusable ingestion unit (`runIngest`) turns one URL into a transcript (APIFY for YouTube, iTunes-Lookup + Whisper for Apple Podcast) then into insight rows. The brand-voice writer is extracted into a shared `brandVoice.ts` used by both `/trends` and `/inspiration`; insight resonance reuses the trends 👍/👎 embedding profile. v1 is single-URL only; the ingestion unit is written loop-ready so a future channel pipeline is just a fan-out wrapper.

**Tech Stack:** Next.js 16.2.4 (App Router), better-sqlite3, OpenAI Whisper (`whisper-1`), APIFY (`karamelo~youtube-transcripts`), OpenRouter via `llmService`, OpenAI `text-embedding-3-small`, Tailwind.

**Verification convention (per project CLAUDE.md):** This repo has no unit-test framework. Verification = `cd dashboard && npm run build` compiles, plus `npx tsx scripts/<smoke>.ts` smoke scripts. Each task ends with a build and (where relevant) a smoke script + commit. Commit messages in English, no `Co-Authored-By`.

**Reusable signatures (verbatim from codebase — do not re-derive):**

```ts
// src/services/llmService.ts
import { getLLMService } from '@/services/llmService';
const llm = getLLMService();
const result = await llm.call({
  stage: 'some_stage',
  messages: [{ role: 'system', content: '...' }, { role: 'user', content: '...' }],
  options: { temperature: 0.8, maxTokens: 1500, models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3.5-flash'], retryCount: 2, timeoutMs: 45_000 },
});
// result: { success: boolean; model: string|null; content: string|null; usage: {prompt_tokens?,completion_tokens?,total_tokens?}; error?: string }

// src/services/trends/embeddings.ts
import { embedTexts, embedText, cosine, interestScore, parseEmbedding } from '@/services/trends/embeddings';
// embedTexts(texts: string[]): Promise<(number[]|null)[]>
// interestScore(vec: number[], likedVecs: number[][], dislikedVecs?: number[][], k?=3, lambda?=0.5): number
// parseEmbedding(raw: string|null|undefined): number[]|null

// src/services/subtitleGenerator.ts
import { transcribeAudio } from '@/services/subtitleGenerator';
// transcribeAudio(audioPath: string, opts?: {language?,model?,maxDurationSec?}): Promise<{text,language,duration,segments,words}>

// src/db/index.ts
import { getDb } from '@/db';   // better-sqlite3 Database
```

---

## File Structure

**New service module `src/services/inspiration/`:**
- `types.ts` — `InsightCandidate`, `IngestInput`, `SourceType` types
- `applePodcast.ts` — parse Apple URL, iTunes Lookup → episode audio URL
- `sources.ts` — detect source type + fetch transcript (YouTube / Apple / manual)
- `extractor.ts` — `extractInsights(transcript, opts)` (chunked LLM extraction)
- `resonance.ts` — load trends 👍/👎 profile + score an embedding to 0-100
- `draftWriter.ts` — `writeInsightPost(insight, userNote)` → Threads draft
- `pipeline.ts` — `runIngest(sourceId)` orchestration (loop-ready unit)

**Shared refactor:**
- `src/services/brandVoice.ts` — NEW, exports `AUTHOR_VOICE` + `WRITING_RULES` (extracted verbatim from `draftGenerator.ts`)
- `src/services/trends/draftGenerator.ts` — MODIFY to import from `brandVoice.ts` (behavior unchanged)

**DB:** `src/db/index.ts` — add `insights` + `insight_drafts` tables + indexes.

**API `src/app/api/inspiration/`:**
- `ingest/route.ts` (POST), `sources/[id]/route.ts` (GET), `insights/route.ts` (GET), `insights/[id]/status/route.ts` (POST), `insights/[id]/draft/route.ts` (POST), `drafts/route.ts` (GET)

**UI:** `src/app/inspiration/page.tsx` (NEW) + `src/components/Navigation.tsx` (MODIFY — add nav item)

**Smoke scripts:** `scripts/test-apple-podcast.ts`, `scripts/test-inspiration-ingest.ts`

---

## Task 1: DB tables — `insights` + `insight_drafts`

**Files:**
- Modify: `dashboard/src/db/index.ts` (add CREATE TABLE blocks next to the `trend_topics` block, ~line 243; add indexes near other `safeIndex` calls)

- [ ] **Step 1: Add the two CREATE TABLE blocks**

In `src/db/index.ts`, immediately after the `trend_*` table creation blocks, add:

```ts
_db!.exec(`
  CREATE TABLE IF NOT EXISTS insights (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id   INTEGER NOT NULL REFERENCES content_summaries(id) ON DELETE CASCADE,
    hook        TEXT    NOT NULL,
    idea        TEXT    NOT NULL,
    why_share   TEXT,
    category    TEXT,
    resonance   REAL,
    embedding   TEXT,
    origin      TEXT    NOT NULL DEFAULT 'ai_mined',
    status      TEXT    NOT NULL DEFAULT 'new',
    source_ts   TEXT,
    created_at  TEXT    DEFAULT (datetime('now'))
  )
`);

_db!.exec(`
  CREATE TABLE IF NOT EXISTS insight_drafts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    insight_id  INTEGER NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
    user_note   TEXT,
    draft_text  TEXT    NOT NULL,
    platform    TEXT    NOT NULL DEFAULT 'threads',
    status      TEXT    NOT NULL DEFAULT 'pending_review',
    created_at  TEXT    DEFAULT (datetime('now'))
  )
`);
```

- [ ] **Step 2: Add indexes**

Near the other `safeIndex(...)` calls add:

```ts
safeIndex('CREATE INDEX IF NOT EXISTS idx_insights_source ON insights(source_id)');
safeIndex('CREATE INDEX IF NOT EXISTS idx_insights_status ON insights(status)');
safeIndex('CREATE INDEX IF NOT EXISTS idx_insights_resonance ON insights(resonance)');
safeIndex('CREATE INDEX IF NOT EXISTS idx_insight_drafts_insight ON insight_drafts(insight_id)');
```

- [ ] **Step 3: Verify tables create**

Run: `cd dashboard && npx tsx -e "import { getDb } from './src/db'; const db = getDb(); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('insights','insight_drafts')\").all());"`
Expected: prints `[ { name: 'insights' }, { name: 'insight_drafts' } ]`

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/db/index.ts
git commit -m "feat(inspiration): add insights and insight_drafts tables"
```

---

## Task 2: Types — `src/services/inspiration/types.ts`

**Files:**
- Create: `dashboard/src/services/inspiration/types.ts`

- [ ] **Step 1: Write the file**

```ts
/** Source kind for an ingested item. */
export type SourceType = 'youtube' | 'apple_podcast' | 'manual';

/** A single insight as produced by the extractor (pre-DB). */
export interface InsightCandidate {
  hook: string;        // 記憶點一句話
  idea: string;        // 2-3 句把 mindset 講清楚
  why_share: string;   // 為什麼新穎 / 值得分享
  category: string;    // 'mindset' | 'tactic' | 'contrarian' | 'story'
}

/** Input to an ingest request. Exactly one of url/text is required. */
export interface IngestInput {
  url?: string;
  text?: string;            // manual paste
  title?: string;           // manual title (optional)
  userPoints?: string;      // 入口 A: Tommy's own highlighted points
}

/** Resolved source: transcript + metadata, before insight extraction. */
export interface ResolvedSource {
  sourceType: SourceType;
  title: string | null;
  channelName: string | null;
  thumbnailUrl: string | null;
  transcript: string;
  costUsd: number;          // transcription cost (Whisper); 0 for youtube/manual
}
```

- [ ] **Step 2: Verify compile**

Run: `cd dashboard && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i 'inspiration/types' || echo "no type errors in types.ts"`
Expected: `no type errors in types.ts`

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/services/inspiration/types.ts
git commit -m "feat(inspiration): add shared types"
```

---

## Task 3: Extract shared brand voice — `brandVoice.ts` + refactor `draftGenerator.ts`

**Goal:** Pull the reusable brand-voice text out of `draftGenerator.ts` into `brandVoice.ts` with ZERO change to the produced prompt text (so `/trends` behavior is identical).

**Files:**
- Create: `dashboard/src/services/brandVoice.ts`
- Modify: `dashboard/src/services/trends/draftGenerator.ts`

- [ ] **Step 1: Create `brandVoice.ts`** (text copied verbatim from current `draftGenerator.ts`)

```ts
/**
 * Shared brand voice + writing rules for any post-generation stage (trends, inspiration).
 * Extracted verbatim from the original trends draftGenerator so existing behavior is unchanged.
 */

// The author persona block (mirrors what the trends SYSTEM_PROMPT inlined).
export const AUTHOR_VOICE = `## 作者語氣（模仿，這是品牌聲音）
- 第一人稱、誠實、有溫度、敢講真實心境，不裝專家
- 自嘲式幽默，偶爾用「XD」
- 中英夾雜，技術詞保留英文（如 AI、Agent、prompt）
- 台灣口語、生活感，有畫面的具體細節
- 結尾收斂出一個有溫度的觀點`;

export const WRITING_RULES = `## 寫作規則
- 繁體中文，口語化，像真人在 Threads 上講話
- 每則 300-450 字（含空格和換行）
- 開頭第一句話就要抓住人，不要鋪陳
- 適度用換行增加閱讀節奏，但不要每句都換行
- 不要使用任何 emoji
- 不要使用破折號（——）
- 貼文本身要有獨立價值，讀完就有收穫
- 要有觀點、有立場，不要兩邊都不得罪的廢話
- 不要用 hashtag

## 禁用句式和詞彙（絕對不能出現）
- 「這不是 X，而是 Y」的句式
- 「超到位」「到位」
- 革命性、顛覆、無縫、賦能、一站式、全方位、生態系、賽道、風口、降維打擊
- 底層邏輯、頂層設計、抓手、閉環、打通、鏈路、觸達、心智、破圈、種草
- 拉齊、對齊、沉澱、復盤、迭代、深耕、佈局、卡位、All-in
- 不可思議、令人驚嘆、game changer、next level、深度解析、一文看懂
- 乾貨滿滿、建議收藏、看完秒懂
- 「老實說」（AI 嚴重過度使用，整篇最多一次，盡量別用）
- 任何 emoji 符號

## AI 常見文體通病（自我檢查）
- 不要用文藝腔或詩意化的方式描述日常事物
- 不要把簡單的事情用複雜的比喻包裝（要用比喻，確認是台灣人日常會說的比喻）`;
```

- [ ] **Step 2: Refactor `draftGenerator.ts` to import the shared text**

In `src/services/trends/draftGenerator.ts`:
1. Add import at top (after existing imports):
```ts
import { AUTHOR_VOICE, WRITING_RULES } from '@/services/brandVoice';
```
2. DELETE the local `const WRITING_RULES = \`...\`;` block entirely.
3. In `SYSTEM_PROMPT`, replace the inline author-voice block:
```
## 作者語氣（模仿，這是品牌聲音）
- 第一人稱、誠實、有溫度、敢講真實心境，不裝專家
- 自嘲式幽默，偶爾用「XD」
- 中英夾雜，技術詞保留英文（如 AI、Agent、prompt）
- 台灣口語、生活感，有畫面的具體細節
- 結尾收斂出一個有溫度的觀點

${WRITING_RULES}
```
with:
```
${AUTHOR_VOICE}

${WRITING_RULES}
```
(The rendered string is byte-identical — `AUTHOR_VOICE` holds the same 6 lines, `WRITING_RULES` the same block.)

- [ ] **Step 3: Verify the trends prompt text is unchanged**

Run: `cd dashboard && npx tsx -e "import('./src/services/trends/draftGenerator').then(()=>console.log('import-ok'))"`
Expected: prints `import-ok` (module loads; no missing-symbol errors).

- [ ] **Step 4: Build**

Run: `cd dashboard && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/services/brandVoice.ts dashboard/src/services/trends/draftGenerator.ts
git commit -m "refactor(brand-voice): extract shared AUTHOR_VOICE + WRITING_RULES"
```

---

## Task 4: Apple Podcast resolver — `applePodcast.ts`

**Approach:** Apple Podcast episode links look like `podcasts.apple.com/<locale>/podcast/<slug>/id<podcastId>?i=<episodeId>`. The iTunes Lookup API (`https://itunes.apple.com/lookup?id=<episodeId>`) returns the episode with `episodeUrl` (direct audio), `trackName` (episode title), `collectionName` (show name), `artworkUrl600`. If there's no `?i=`, fall back to looking up the show, fetching its `feedUrl` RSS, and taking the newest `<enclosure url>`.

**Files:**
- Create: `dashboard/src/services/inspiration/applePodcast.ts`
- Create: `dashboard/scripts/test-apple-podcast.ts`

- [ ] **Step 1: Write `applePodcast.ts`**

```ts
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('apple-podcast');

export interface AppleEpisode {
  title: string | null;
  channelName: string | null;
  audioUrl: string;
  thumbnailUrl: string | null;
}

/** Pull podcastId (id…) and episodeId (?i=…) out of an Apple Podcasts URL. */
export function parseAppleUrl(url: string): { podcastId?: string; episodeId?: string } {
  const idMatch = url.match(/\/id(\d+)/);
  const epMatch = url.match(/[?&]i=(\d+)/);
  return { podcastId: idMatch?.[1], episodeId: epMatch?.[1] };
}

async function itunesLookup(id: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`https://itunes.apple.com/lookup?id=${id}&entity=podcastEpisode`);
  if (!r.ok) throw new Error(`iTunes lookup ${r.status}`);
  const data = await r.json();
  return (data?.results || []) as Record<string, unknown>[];
}

/** First <enclosure url="…"> in an RSS feed (newest episode), with show title. */
async function firstEnclosureFromFeed(feedUrl: string): Promise<AppleEpisode> {
  const r = await fetch(feedUrl);
  if (!r.ok) throw new Error(`RSS fetch ${r.status}`);
  const xml = await r.text();
  const enc = xml.match(/<enclosure[^>]*\surl=["']([^"']+)["']/i);
  if (!enc) throw new Error('No <enclosure> audio URL found in feed');
  const showTitle = xml.match(/<title>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/title>/i);
  const itemTitle = xml.match(/<item>[\s\S]*?<title>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/title>/i);
  return {
    audioUrl: enc[1],
    title: itemTitle?.[1]?.trim() || null,
    channelName: showTitle?.[1]?.trim() || null,
    thumbnailUrl: null,
  };
}

/** Resolve an Apple Podcasts URL to a downloadable audio URL + metadata. */
export async function resolveAppleEpisode(url: string): Promise<AppleEpisode> {
  const { podcastId, episodeId } = parseAppleUrl(url);
  if (!podcastId && !episodeId) throw new Error('Not a recognizable Apple Podcasts URL');

  if (episodeId) {
    const results = await itunesLookup(episodeId);
    const ep = results.find((r) => r.wrapperType === 'podcastEpisode') || results[0];
    const audioUrl = ep?.episodeUrl as string | undefined;
    if (audioUrl) {
      return {
        audioUrl,
        title: (ep?.trackName as string) || null,
        channelName: (ep?.collectionName as string) || null,
        thumbnailUrl: (ep?.artworkUrl600 as string) || null,
      };
    }
    log.warn({ episodeId }, 'episodeUrl missing from iTunes lookup, falling back to feed');
  }

  // Fall back: look up the show, read its RSS feed, take newest enclosure.
  const showResults = await itunesLookup(podcastId!);
  const feedUrl = showResults.find((r) => r.feedUrl)?.feedUrl as string | undefined;
  if (!feedUrl) throw new Error('No feedUrl for this podcast');
  return firstEnclosureFromFeed(feedUrl);
}
```

- [ ] **Step 2: Write smoke script `scripts/test-apple-podcast.ts`**

```ts
import { resolveAppleEpisode, parseAppleUrl } from '../src/services/inspiration/applePodcast';

const url = process.argv[2];
if (!url) { console.error('Usage: npx tsx scripts/test-apple-podcast.ts <apple-podcast-episode-url>'); process.exit(1); }

(async () => {
  console.log('parsed:', parseAppleUrl(url));
  const ep = await resolveAppleEpisode(url);
  console.log('resolved:', { title: ep.title, channel: ep.channelName, hasAudio: !!ep.audioUrl });
  console.log('audioUrl starts with http:', ep.audioUrl.startsWith('http'));
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
```

- [ ] **Step 3: Run the smoke script with a real Apple episode URL**

Run (ask Tommy for a real Apple Podcasts *episode* link with `?i=`; example shape):
`cd dashboard && npx tsx scripts/test-apple-podcast.ts "https://podcasts.apple.com/us/podcast/<slug>/id<podcastId>?i=<episodeId>"`
Expected: prints a non-empty `title`, `channel`, `hasAudio: true`, `audioUrl starts with http: true`.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/services/inspiration/applePodcast.ts dashboard/scripts/test-apple-podcast.ts
git commit -m "feat(inspiration): Apple Podcast audio URL resolver via iTunes Lookup"
```

---

## Task 5: Source transcript fetcher — `sources.ts`

**Files:**
- Create: `dashboard/src/services/inspiration/sources.ts`

- [ ] **Step 1: Write `sources.ts`**

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createChildLogger } from '@/lib/logger';
import { withRetry } from '@/lib/retry';
import { transcribeAudio } from '@/services/subtitleGenerator';
import { resolveAppleEpisode } from './applePodcast';
import type { IngestInput, ResolvedSource, SourceType } from './types';

const log = createChildLogger('inspiration-sources');

/** Decide which kind of source an input is. */
export function detectSourceType(input: IngestInput): SourceType {
  if (input.text && !input.url) return 'manual';
  const u = input.url || '';
  if (/youtube\.com|youtu\.be/i.test(u)) return 'youtube';
  if (/podcasts\.apple\.com/i.test(u)) return 'apple_podcast';
  throw new Error('Unrecognized URL — expected a YouTube or Apple Podcasts link');
}

function youTubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([\w-]{11})/);
  return m?.[1] || null;
}

/** Fetch a YouTube transcript via APIFY (same actor used by the pipeline). */
async function fetchYouTubeTranscript(url: string): Promise<string> {
  const apifyToken = process.env.APIFY_API_TOKEN;
  if (!apifyToken) throw new Error('APIFY_API_TOKEN not set');
  const videoId = youTubeId(url);
  if (!videoId) throw new Error('Could not parse YouTube video id');
  const resp = await withRetry(async () => {
    const r = await fetch(
      `https://api.apify.com/v2/acts/karamelo~youtube-transcripts/run-sync-get-dataset-items?token=${apifyToken}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [`https://www.youtube.com/watch?v=${videoId}`], outputFormat: 'singleStringText' }) },
    );
    if (!r.ok) throw new Error(`Apify ${r.status}`);
    return r;
  }, { label: `apify-transcript:${videoId}` });
  const data = await resp.json();
  return data?.[0]?.captions || data?.[0]?.text || data?.[0]?.transcript || '';
}

/** Download an audio URL to a temp file; returns the path (caller deletes). */
async function downloadAudio(audioUrl: string): Promise<string> {
  const r = await fetch(audioUrl);
  if (!r.ok) throw new Error(`Audio download ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const tmp = path.join(os.tmpdir(), `inspiration-${Date.now()}.mp3`);
  fs.writeFileSync(tmp, buf);
  return tmp;
}

/**
 * Resolve any IngestInput to a transcript + metadata.
 * Loop-ready: a future channel pipeline calls this per episode/video.
 */
export async function resolveSource(input: IngestInput): Promise<ResolvedSource> {
  const sourceType = detectSourceType(input);

  if (sourceType === 'manual') {
    return { sourceType, title: input.title || null, channelName: null, thumbnailUrl: null, transcript: input.text!.trim(), costUsd: 0 };
  }

  if (sourceType === 'youtube') {
    const transcript = await fetchYouTubeTranscript(input.url!);
    if (!transcript.trim()) throw new Error('YouTube transcript was empty');
    return { sourceType, title: input.title || null, channelName: null, thumbnailUrl: null, transcript, costUsd: 0 };
  }

  // apple_podcast
  const ep = await resolveAppleEpisode(input.url!);
  const audioPath = await downloadAudio(ep.audioUrl);
  try {
    const t = await transcribeAudio(audioPath, { language: 'zh' });
    // Whisper pricing ≈ $0.006 / minute.
    const costUsd = ((t.duration || 0) / 60) * 0.006;
    log.info({ durationSec: t.duration, costUsd: costUsd.toFixed(3) }, 'Podcast transcribed');
    return { sourceType, title: input.title || ep.title, channelName: ep.channelName, thumbnailUrl: ep.thumbnailUrl, transcript: t.text, costUsd };
  } finally {
    try { fs.unlinkSync(audioPath); } catch { /* best effort */ }
  }
}
```

> NOTE: confirm `withRetry` is importable from `@/lib/retry` — Task-2 explore found it used in `classify.ts`. If the path differs, grep `export.*withRetry` and adjust the import.

- [ ] **Step 2: Verify compile**

Run: `cd dashboard && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i 'inspiration/sources' || echo "sources.ts clean"`
Expected: `sources.ts clean`

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/services/inspiration/sources.ts
git commit -m "feat(inspiration): source transcript resolver (youtube/apple/manual)"
```

---

## Task 6: Insight extractor — `extractor.ts`

**Approach:** Chunk the transcript into ~8000-char windows, cap at 4 chunks (cost guard — log when truncated), extract a few insights per chunk via `llm.call`, dedupe by `hook`. Supports entry A (`userPoints` given → polish those) and entry B (mine fresh insights).

**Files:**
- Create: `dashboard/src/services/inspiration/extractor.ts`

- [ ] **Step 1: Write `extractor.ts`**

```ts
import { getLLMService } from '@/services/llmService';
import { VERSION_GUARD_ZH } from '@/services/llm/versionGuard';
import { createChildLogger } from '@/lib/logger';
import type { InsightCandidate } from './types';

const log = createChildLogger('inspiration-extractor');

const CHUNK_CHARS = 8000;
const MAX_CHUNKS = 4; // cost guard: ≈ first 40 min of a podcast

const SYSTEM_PROMPT = `你是一位專門幫經營「AI懶人報」個人品牌的內容策展人。你會讀一段影片/Podcast 的逐字稿，挑出「最值得拿去發社群貼文」的 insight。

## 什麼叫值得分享的 insight
- 反直覺、有記憶點、會讓人想轉發給朋友
- 是一種 mindset / 觀點 / 心法，不是流水帳或泛泛而談
- 越具體、越有畫面越好；避免「要努力」「要堅持」這種廢話

## 每個 insight 要產出
- hook：一句話的記憶點（會讓人停下來的那句）
- idea：2-3 句把這個 mindset 講清楚
- why_share：為什麼這個點新穎 / 值得分享（一句話）
- category：mindset | tactic | contrarian | story 四選一

${VERSION_GUARD_ZH}

## 輸出格式
嚴格輸出 JSON object，不要加 markdown code fence：
{ "insights": [ { "hook": "...", "idea": "...", "why_share": "...", "category": "mindset" } ] }
挑最好的 2-4 個就好，寧缺勿濫。`;

function parseInsightJson(content: string): InsightCandidate[] {
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(objMatch ? objMatch[0] : cleaned) as { insights?: unknown };
  const arr = Array.isArray(parsed.insights) ? parsed.insights : [];
  return arr
    .map((x) => x as Record<string, unknown>)
    .filter((x) => typeof x.hook === 'string' && typeof x.idea === 'string')
    .map((x) => ({
      hook: String(x.hook).trim(),
      idea: String(x.idea).trim(),
      why_share: String(x.why_share || '').trim(),
      category: ['mindset', 'tactic', 'contrarian', 'story'].includes(String(x.category)) ? String(x.category) : 'mindset',
    }));
}

function chunk(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length && out.length < MAX_CHUNKS; i += CHUNK_CHARS) out.push(text.slice(i, i + CHUNK_CHARS));
  const totalChunks = Math.ceil(text.length / CHUNK_CHARS);
  if (totalChunks > MAX_CHUNKS) log.warn({ totalChunks, used: MAX_CHUNKS }, 'Transcript truncated by chunk cap (cost guard)');
  return out;
}

/**
 * Extract insight candidates from a transcript.
 * - entry B (default): mine fresh insights chunk-by-chunk.
 * - entry A: when userPoints given, polish those into insights using the transcript as context.
 */
export async function extractInsights(
  transcript: string,
  opts: { title?: string; userPoints?: string } = {},
): Promise<InsightCandidate[]> {
  const llm = getLLMService();
  const titleLine = opts.title ? `（內容標題：${opts.title}）\n` : '';

  // Entry A: single call, anchored on Tommy's own points.
  if (opts.userPoints?.trim()) {
    const userPrompt = `${titleLine}以下是逐字稿（節錄）：\n${transcript.slice(0, CHUNK_CHARS * 2)}\n\n## 我自己標記的重點（這是核心，請以這些為主幹，用逐字稿補上脈絡與具體細節）\n${opts.userPoints.trim()}\n\n把我的重點整理成 insight。`;
    const r = await llm.call({ stage: 'inspiration_extract_user', messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }], options: { temperature: 0.7, maxTokens: 1500, models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3.5-flash'], retryCount: 2, timeoutMs: 60_000 } });
    if (!r.success || !r.content) throw new Error(r.error || 'LLM extract (user) failed');
    return parseInsightJson(r.content);
  }

  // Entry B: mine each chunk, then dedupe by hook.
  const chunks = chunk(transcript);
  const all: InsightCandidate[] = [];
  for (const [i, c] of chunks.entries()) {
    const userPrompt = `${titleLine}逐字稿片段 ${i + 1}/${chunks.length}：\n${c}\n\n挑出這段裡最值得分享的 insight。`;
    const r = await llm.call({ stage: 'inspiration_extract', messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }], options: { temperature: 0.8, maxTokens: 1500, models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3.5-flash'], retryCount: 2, timeoutMs: 60_000 } });
    if (r.success && r.content) {
      try { all.push(...parseInsightJson(r.content)); } catch (e) { log.warn({ chunk: i, err: (e as Error).message }, 'chunk parse failed, skipping'); }
    }
  }
  const seen = new Set<string>();
  const deduped = all.filter((x) => { const k = x.hook.slice(0, 24); if (seen.has(k)) return false; seen.add(k); return true; });
  log.info({ chunks: chunks.length, raw: all.length, deduped: deduped.length }, 'Insights extracted');
  return deduped;
}
```

- [ ] **Step 2: Verify compile**

Run: `cd dashboard && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i 'inspiration/extractor' || echo "extractor.ts clean"`
Expected: `extractor.ts clean`

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/services/inspiration/extractor.ts
git commit -m "feat(inspiration): chunked insight extractor (entry A + B)"
```

---

## Task 7: Resonance scoring — `resonance.ts`

**Files:**
- Create: `dashboard/src/services/inspiration/resonance.ts`

- [ ] **Step 1: Write `resonance.ts`**

```ts
import { getDb } from '@/db';
import { interestScore, parseEmbedding } from '@/services/trends/embeddings';

const MIN_PROFILE = 5; // need at least 5 👍 before resonance is meaningful

export interface InterestProfile {
  likedVecs: number[][];
  dislikedVecs: number[][];
  hasProfile: boolean;
}

/** Load the trends 👍/👎 embedding profile (shared with /trends). */
export function loadInterestProfile(): InterestProfile {
  const db = getDb();
  const rows = db.prepare(
    'SELECT interested, embedding FROM trend_posts WHERE interested != 0 AND embedding IS NOT NULL',
  ).all() as Array<{ interested: number; embedding: string }>;
  const likedVecs: number[][] = [];
  const dislikedVecs: number[][] = [];
  for (const r of rows) {
    const v = parseEmbedding(r.embedding);
    if (!v) continue;
    (r.interested === 1 ? likedVecs : dislikedVecs).push(v);
  }
  return { likedVecs, dislikedVecs, hasProfile: likedVecs.length >= MIN_PROFILE };
}

/** Score one embedding to 0-100 against the profile, or null when no profile yet. */
export function scoreResonance(vec: number[] | null, profile: InterestProfile): number | null {
  if (!vec || !profile.hasProfile) return null;
  const raw = interestScore(vec, profile.likedVecs, profile.dislikedVecs); // ~[-0.5, 1]
  return Math.round(Math.max(0, Math.min(1, raw)) * 100);
}
```

- [ ] **Step 2: Verify compile**

Run: `cd dashboard && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i 'inspiration/resonance' || echo "resonance.ts clean"`
Expected: `resonance.ts clean`

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/services/inspiration/resonance.ts
git commit -m "feat(inspiration): resonance scoring via shared trends profile"
```

---

## Task 8: Insight → Threads draft writer — `draftWriter.ts`

**Files:**
- Create: `dashboard/src/services/inspiration/draftWriter.ts`

- [ ] **Step 1: Write `draftWriter.ts`**

```ts
import { getLLMService } from '@/services/llmService';
import { AUTHOR_VOICE, WRITING_RULES } from '@/services/brandVoice';
import { VERSION_GUARD_ZH } from '@/services/llm/versionGuard';

const SYSTEM_PROMPT = `你是「AI懶人報」帳號的主理人本人，正在 Threads 上經營個人品牌。我會給你一個 insight（一個心法/觀點），以及我自己想補充的經驗或角度。你要用我的品牌聲音，把它寫成一則能讓人有收穫、想分享的 Threads 貼文。

不要只是覆述 insight，要用我的角度重新詮釋，加入具體的生活感與觀點。

${AUTHOR_VOICE}

${WRITING_RULES}

${VERSION_GUARD_ZH}

直接輸出貼文純文字，不要任何解釋、不要 JSON、不要標題。`;

export interface InsightForDraft {
  hook: string;
  idea: string;
  why_share?: string | null;
}

/** Write one Threads draft from an insight + Tommy's optional note. */
export async function writeInsightPost(insight: InsightForDraft, userNote?: string): Promise<string> {
  const noteBlock = userNote?.trim()
    ? `\n## 我自己想補充的經驗 / 角度（這是貼文的靈魂，請以此為核心發揮）\n${userNote.trim()}\n`
    : '';
  const userPrompt = `## Insight\nhook：${insight.hook}\nidea：${insight.idea}${insight.why_share ? `\n為什麼值得分享：${insight.why_share}` : ''}\n${noteBlock}\n請寫成一則 Threads 貼文。`;

  const llm = getLLMService();
  const r = await llm.call({
    stage: 'inspiration_draft',
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }],
    options: { temperature: 0.9, maxTokens: 1500, models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3.5-flash'], retryCount: 2, timeoutMs: 45_000 },
  });
  if (!r.success || !r.content) throw new Error(r.error || 'LLM draft failed');
  return r.content.trim();
}
```

- [ ] **Step 2: Verify compile**

Run: `cd dashboard && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i 'inspiration/draftWriter' || echo "draftWriter.ts clean"`
Expected: `draftWriter.ts clean`

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/services/inspiration/draftWriter.ts
git commit -m "feat(inspiration): insight-to-Threads draft writer (shared brand voice)"
```

---

## Task 9: Ingest orchestration — `pipeline.ts` + end-to-end smoke

**Files:**
- Create: `dashboard/src/services/inspiration/pipeline.ts`
- Create: `dashboard/scripts/test-inspiration-ingest.ts`

- [ ] **Step 1: Write `pipeline.ts`**

```ts
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { embedTexts } from '@/services/trends/embeddings';
import { resolveSource } from './sources';
import { extractInsights } from './extractor';
import { loadInterestProfile, scoreResonance } from './resonance';
import type { IngestInput } from './types';

const log = createChildLogger('inspiration-pipeline');

/** Create a content_summaries row in 'processing' state; returns its id. */
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

/**
 * Full ingest for one source row: resolve transcript → extract insights →
 * embed + score resonance → insert insight rows. Updates content_summaries status.
 * Loop-ready: future channel pipeline calls createSourceRow + runIngest per item.
 */
export async function runIngest(sourceId: number, input: IngestInput): Promise<{ insightCount: number }> {
  const db = getDb();
  try {
    const resolved = await resolveSource(input);
    db.prepare(
      `UPDATE content_summaries SET title = COALESCE(title, ?), channel_name = ?, thumbnail_url = ?, transcript = ?, source_type = ?, cost_usd = ? WHERE id = ?`,
    ).run(resolved.title, resolved.channelName, resolved.thumbnailUrl, resolved.transcript, resolved.sourceType, resolved.costUsd, sourceId);

    const origin = input.userPoints?.trim() ? 'user_marked' : 'ai_mined';
    const candidates = await extractInsights(resolved.transcript, { title: resolved.title || undefined, userPoints: input.userPoints });
    if (!candidates.length) throw new Error('No insights extracted');

    const vecs = await embedTexts(candidates.map((c) => `${c.hook}\n${c.idea}`));
    const profile = loadInterestProfile();

    const insert = db.prepare(
      `INSERT INTO insights (source_id, hook, idea, why_share, category, resonance, embedding, origin, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
    );
    const tx = db.transaction(() => {
      candidates.forEach((c, i) => {
        const vec = vecs[i] || null;
        const resonance = scoreResonance(vec, profile);
        insert.run(sourceId, c.hook, c.idea, c.why_share, c.category, resonance, vec ? JSON.stringify(vec) : null, origin);
      });
    });
    tx();

    db.prepare(`UPDATE content_summaries SET status = 'completed', completed_at = datetime('now') WHERE id = ?`).run(sourceId);
    log.info({ sourceId, insightCount: candidates.length, origin }, 'Ingest complete');
    return { insightCount: candidates.length };
  } catch (e) {
    const msg = (e as Error).message;
    db.prepare(`UPDATE content_summaries SET status = 'failed', error_message = ? WHERE id = ?`).run(msg, sourceId);
    log.error({ sourceId, err: msg }, 'Ingest failed');
    throw e;
  }
}
```

- [ ] **Step 2: Write smoke script `scripts/test-inspiration-ingest.ts`**

```ts
import { createSourceRow, runIngest } from '../src/services/inspiration/pipeline';
import { getDb } from '../src/db';

const url = process.argv[2];
if (!url) { console.error('Usage: npx tsx scripts/test-inspiration-ingest.ts <youtube-or-apple-url>'); process.exit(1); }

(async () => {
  const input = { url };
  const id = createSourceRow(input);
  console.log('source row:', id);
  const { insightCount } = await runIngest(id, input);
  console.log('insights inserted:', insightCount);
  const rows = getDb().prepare('SELECT hook, category, resonance FROM insights WHERE source_id = ?').all(id);
  console.log(JSON.stringify(rows, null, 2));
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
```

- [ ] **Step 3: Run end-to-end on a real YouTube URL**

Run: `cd dashboard && npx tsx scripts/test-inspiration-ingest.ts "https://www.youtube.com/watch?v=<id>"`
Expected: prints `insights inserted: N` (N ≥ 1) and a JSON array of `{hook, category, resonance}` rows. `resonance` may be `null` if the trends 👍 profile has < 5 likes — that's expected.

- [ ] **Step 4: Build**

Run: `cd dashboard && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/services/inspiration/pipeline.ts dashboard/scripts/test-inspiration-ingest.ts
git commit -m "feat(inspiration): ingest orchestration + end-to-end smoke script"
```

---

## Task 10: API routes — `src/app/api/inspiration/`

**Files:**
- Create: `dashboard/src/app/api/inspiration/ingest/route.ts`
- Create: `dashboard/src/app/api/inspiration/sources/[id]/route.ts`
- Create: `dashboard/src/app/api/inspiration/insights/route.ts`
- Create: `dashboard/src/app/api/inspiration/insights/[id]/status/route.ts`
- Create: `dashboard/src/app/api/inspiration/insights/[id]/draft/route.ts`
- Create: `dashboard/src/app/api/inspiration/drafts/route.ts`

- [ ] **Step 1: `ingest/route.ts`** (fire-and-forget — return immediately, process in background)

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createSourceRow, runIngest } from '@/services/inspiration/pipeline';
import { createChildLogger } from '@/lib/logger';
import type { IngestInput } from '@/services/inspiration/types';

const log = createChildLogger('api:inspiration-ingest');

/** Body: { url?, text?, title?, userPoints? }. Starts ingest in background, returns sourceId. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as IngestInput;
  if (!body.url && !body.text) return NextResponse.json({ error: 'url or text required' }, { status: 400 });

  const sourceId = createSourceRow(body);
  // Fire-and-forget: heavy work (transcription, LLM) runs after the response.
  runIngest(sourceId, body).catch((e) => log.error({ sourceId, err: (e as Error).message }, 'background ingest failed'));
  return NextResponse.json({ sourceId, status: 'processing' });
}
```

- [ ] **Step 2: `sources/[id]/route.ts`** (status polling)

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const row = db.prepare('SELECT id, url, source_type, title, status, error_message, cost_usd FROM content_summaries WHERE id = ?').get(Number(id));
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const insightCount = (db.prepare('SELECT COUNT(*) c FROM insights WHERE source_id = ?').get(Number(id)) as { c: number }).c;
  return NextResponse.json({ ...row, insightCount });
}
```

> NOTE: Next.js 16 dynamic route params are async (`params: Promise<...>`). Confirm against an existing dynamic route (e.g. `src/app/api/trends/posts/[id]/interested/route.ts`) and match its exact `params` signature.

- [ ] **Step 3: `insights/route.ts`** (list + filter + semantic search)

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { embedText, parseEmbedding, cosine } from '@/services/trends/embeddings';

/** Query: ?status=new|saved|hidden|all (default exclude hidden), ?sort=resonance|newest, ?q=<semantic search>, ?limit */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get('status') || 'visible';
  const sort = searchParams.get('sort') || 'resonance';
  const q = searchParams.get('q')?.trim();
  const limit = parseInt(searchParams.get('limit') || '100', 10);
  const db = getDb();

  let where = '';
  if (status === 'saved') where = "WHERE i.status = 'saved'";
  else if (status === 'new') where = "WHERE i.status = 'new'";
  else if (status === 'hidden') where = "WHERE i.status = 'hidden'";
  else where = "WHERE i.status != 'hidden'"; // 'visible'

  const rows = db.prepare(
    `SELECT i.*, c.title AS source_title, c.url AS source_url, c.source_type
     FROM insights i JOIN content_summaries c ON c.id = i.source_id
     ${where} ORDER BY i.created_at DESC LIMIT 500`,
  ).all() as Array<Record<string, unknown>>;

  let result = rows;
  if (q) {
    const qv = await embedText(q);
    if (qv) {
      result = rows
        .map((r) => ({ r, sim: (() => { const v = parseEmbedding(r.embedding as string); return v ? cosine(qv, v) : -1; })() }))
        .sort((a, b) => b.sim - a.sim)
        .map((x) => x.r);
    }
  } else if (sort === 'resonance') {
    result = rows.slice().sort((a, b) => (Number(b.resonance ?? -1)) - (Number(a.resonance ?? -1)));
  }

  const insights = result.slice(0, limit).map((r) => { delete r.embedding; return r; });
  return NextResponse.json({ insights, total: insights.length });
}
```

- [ ] **Step 4: `insights/[id]/status/route.ts`** (save / hide)

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

/** Body: { status: 'saved' | 'hidden' | 'new' } */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const status = body.status;
  if (!['saved', 'hidden', 'new'].includes(status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  getDb().prepare('UPDATE insights SET status = ? WHERE id = ?').run(status, Number(id));
  return NextResponse.json({ ok: true, id: Number(id), status });
}
```

- [ ] **Step 5: `insights/[id]/draft/route.ts`** (remix → Threads draft)

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { writeInsightPost } from '@/services/inspiration/draftWriter';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:inspiration-draft');

interface InsightRow { id: number; hook: string; idea: string; why_share: string | null; }

/** Body: { userNote?: string }. Generates a Threads draft and stores it. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const userNote: string | undefined = typeof body.userNote === 'string' && body.userNote.trim() ? body.userNote : undefined;

  const db = getDb();
  const insight = db.prepare('SELECT id, hook, idea, why_share FROM insights WHERE id = ?').get(Number(id)) as InsightRow | undefined;
  if (!insight) return NextResponse.json({ error: 'insight not found' }, { status: 404 });

  try {
    const draftText = await writeInsightPost(insight, userNote);
    const d = db.prepare(
      `INSERT INTO insight_drafts (insight_id, user_note, draft_text, platform, status) VALUES (?, ?, ?, 'threads', 'pending_review')`,
    ).run(insight.id, userNote || null, draftText);
    return NextResponse.json({ draftId: Number(d.lastInsertRowid), draft_text: draftText });
  } catch (err) {
    log.error({ id, err: (err as Error).message }, 'draft failed');
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 6: `drafts/route.ts`** (list drafts)

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET(_request: NextRequest) {
  const db = getDb();
  const drafts = db.prepare(
    `SELECT d.*, i.hook FROM insight_drafts d JOIN insights i ON i.id = d.insight_id ORDER BY d.created_at DESC LIMIT 100`,
  ).all();
  return NextResponse.json({ drafts });
}
```

- [ ] **Step 7: Build**

Run: `cd dashboard && npm run build`
Expected: build succeeds; the 6 new routes appear in the build route list.

- [ ] **Step 8: Smoke test the routes against the dev server**

With dashboard running (`npm run dev`):
```bash
# start an ingest
curl -s -X POST localhost:3000/api/inspiration/ingest -H 'Content-Type: application/json' -d '{"url":"https://www.youtube.com/watch?v=<id>"}'
# poll source status (use sourceId from above)
curl -s localhost:3000/api/inspiration/sources/<sourceId>
# list insights once completed
curl -s 'localhost:3000/api/inspiration/insights?sort=resonance' | head -c 600
```
Expected: ingest returns `{sourceId, status:"processing"}`; status flips to `completed` with `insightCount > 0`; insights list returns rows.

- [ ] **Step 9: Commit**

```bash
git add dashboard/src/app/api/inspiration
git commit -m "feat(inspiration): API routes (ingest/sources/insights/status/draft/drafts)"
```

---

## Task 11: UI page `/inspiration` + navigation

**Files:**
- Create: `dashboard/src/app/inspiration/page.tsx`
- Modify: `dashboard/src/components/Navigation.tsx` (add nav item)

- [ ] **Step 1: Write `page.tsx`** (mirrors `/trends` page conventions — client component, inline Tailwind, brand classes)

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';

interface Insight {
  id: number; hook: string; idea: string; why_share: string | null; category: string | null;
  resonance: number | null; status: string; origin: string;
  source_title: string | null; source_url: string | null; source_type: string;
}

export default function InspirationPage() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'visible' | 'saved' | 'new'>('visible');
  const [sort, setSort] = useState<'resonance' | 'newest'>('resonance');
  const [q, setQ] = useState('');
  const [ingestUrl, setIngestUrl] = useState('');
  const [ingestPoints, setIngestPoints] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState<Record<number, boolean>>({});
  const [draftNote, setDraftNote] = useState<Record<number, string>>({});
  const [draftText, setDraftText] = useState<Record<number, string>>({});
  const [genBusy, setGenBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ status: statusFilter, sort });
    if (q.trim()) params.set('q', q.trim());
    const res = await fetch(`/api/inspiration/insights?${params}`);
    const data = await res.json();
    setInsights(data.insights || []);
    setLoading(false);
  }, [statusFilter, sort, q]);

  useEffect(() => { load(); }, [load]);

  const ingest = async () => {
    if (!ingestUrl.trim()) return;
    setBusy('ingest');
    await fetch('/api/inspiration/ingest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: ingestUrl.trim(), userPoints: ingestPoints.trim() || undefined }),
    });
    setBusy(null); setIngestUrl(''); setIngestPoints('');
    alert('開始處理中，YouTube 幾秒、Podcast 需數分鐘。完成後重新整理即可看到。');
  };

  const setStatus = async (id: number, status: string) => {
    setBusy(`s${id}`);
    await fetch(`/api/inspiration/insights/${id}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    });
    setBusy(null); load();
  };

  const generate = async (id: number) => {
    setGenBusy(id);
    const res = await fetch(`/api/inspiration/insights/${id}/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userNote: draftNote[id] || '' }),
    });
    const data = await res.json();
    setDraftText((p) => ({ ...p, [id]: data.draft_text || data.error || '產生失敗' }));
    setGenBusy(null);
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <h1 className="text-xl font-bold text-brand mb-4">靈感庫</h1>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mb-6">
        <input value={ingestUrl} onChange={(e) => setIngestUrl(e.target.value)}
          placeholder="貼上 YouTube 或 Apple Podcast 連結"
          className="w-full px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-100 mb-2" />
        <textarea value={ingestPoints} onChange={(e) => setIngestPoints(e.target.value)}
          placeholder="（選填）我自己標的重點 — 填了就用我的角度，留空就讓 AI 挖"
          className="w-full px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-100 mb-2" rows={2} />
        <button onClick={ingest} disabled={busy === 'ingest' || !ingestUrl.trim()}
          className="px-3 py-1.5 text-sm rounded-lg bg-brand/15 text-brand hover:bg-brand/25 disabled:opacity-50">
          {busy === 'ingest' ? '處理中…' : '+ 攝取靈感'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 語意搜尋"
          className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-100" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'visible' | 'saved' | 'new')}
          className="px-2 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-100">
          <option value="visible">全部</option><option value="saved">已存</option><option value="new">新挖到</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as 'resonance' | 'newest')}
          className="px-2 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-100">
          <option value="resonance">共鳴排序</option><option value="newest">最新</option>
        </select>
      </div>

      {loading ? <p className="text-zinc-400">載入中…</p>
        : insights.length === 0 ? <p className="text-zinc-400">還沒有靈感，貼個連結開始吧。</p>
        : insights.map((it) => (
          <div key={it.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mb-3 transition-colors">
            <div className="flex items-center gap-2 mb-2">
              {it.resonance != null && <span className="shrink-0 text-[11px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">🔥 共鳴 {it.resonance}</span>}
              {it.category && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-300">{it.category}</span>}
            </div>
            <p className="text-base font-semibold text-zinc-100 mb-1">{it.hook}</p>
            <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap mb-1">{it.idea}</p>
            {it.why_share && <p className="text-xs text-zinc-500 mb-2">💬 {it.why_share}</p>}
            {it.source_url && <a href={it.source_url} target="_blank" className="text-xs text-brand hover:underline">📺 {it.source_title || it.source_type} ↗</a>}

            <div className="flex gap-2 mt-3">
              <button onClick={() => setStatus(it.id, it.status === 'saved' ? 'new' : 'saved')} disabled={busy === `s${it.id}`}
                className="px-2 py-1 text-xs rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-50">{it.status === 'saved' ? '已存' : '💡 存'}</button>
              <button onClick={() => setStatus(it.id, 'hidden')} disabled={busy === `s${it.id}`}
                className="px-2 py-1 text-xs rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-50">🗑 藏</button>
              <button onClick={() => setDraftOpen((p) => ({ ...p, [it.id]: !p[it.id] }))}
                className="px-2 py-1 text-xs rounded-lg bg-brand/15 text-brand hover:bg-brand/25">✍️ 改寫</button>
            </div>

            {draftOpen[it.id] && (
              <div className="mt-3 border-t border-zinc-800 pt-3">
                <textarea value={draftNote[it.id] || ''} onChange={(e) => setDraftNote((p) => ({ ...p, [it.id]: e.target.value }))}
                  placeholder="加入你的經驗/角度（貼文的靈魂）" rows={2}
                  className="w-full px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-100 mb-2" />
                <button onClick={() => generate(it.id)} disabled={genBusy === it.id}
                  className="px-3 py-1.5 text-sm rounded-lg bg-brand/15 text-brand hover:bg-brand/25 disabled:opacity-50">
                  {genBusy === it.id ? '產生中…' : 'AI 改寫一篇 Threads 貼文 →'}
                </button>
                {draftText[it.id] && (
                  <div className="mt-2">
                    <p className="text-sm text-zinc-200 whitespace-pre-wrap bg-zinc-800/50 rounded-lg p-3">{draftText[it.id]}</p>
                    <button onClick={() => navigator.clipboard.writeText(draftText[it.id])}
                      className="mt-2 px-2 py-1 text-xs rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700">複製</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
```

- [ ] **Step 2: Add nav item in `Navigation.tsx`**

In `src/components/Navigation.tsx`, in the `allNavItems` array, add right after the `/trends` (社群熱點) entry:

```tsx
  {
    href: '/inspiration', label: '靈感庫',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.4 14.4 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
      </svg>
    ),
  },
```
(Match the exact object shape of the surrounding `NavItem` entries — `href`, `label`, `icon`.)

- [ ] **Step 3: Build**

Run: `cd dashboard && npm run build`
Expected: build succeeds; `/inspiration` appears in the route list.

- [ ] **Step 4: Visual smoke check**

With `npm run dev` running, open `http://localhost:3000/inspiration`. Confirm: nav shows 靈感庫; the ingest box + filters render; pasting a YouTube URL and clicking 攝取 shows the alert; after a refresh, insight cards render with hook/idea/source; 改寫 expands and produces a draft.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/app/inspiration/page.tsx dashboard/src/components/Navigation.tsx
git commit -m "feat(inspiration): scrollable insight wall UI + nav entry"
```

---

## Task 12: Final end-to-end verification

- [ ] **Step 1: Full build**

Run: `cd dashboard && npm run build`
Expected: clean build.

- [ ] **Step 2: End-to-end YouTube path**

Run: `cd dashboard && npx tsx scripts/test-inspiration-ingest.ts "https://www.youtube.com/watch?v=<id>"`
Expected: insights inserted ≥ 1.

- [ ] **Step 3: End-to-end Apple Podcast path** (one real episode; incurs Whisper cost)

Run: `cd dashboard && npx tsx scripts/test-inspiration-ingest.ts "https://podcasts.apple.com/.../id<podcastId>?i=<episodeId>"`
Expected: insights inserted ≥ 1; `content_summaries.cost_usd` > 0 for that row.

- [ ] **Step 4: Confirm `/trends` is unchanged**

With dev server running, generate a trends draft as before and confirm output style is identical (brand-voice refactor was behavior-preserving).

- [ ] **Step 5: Final commit (if any docs/cleanup)**

```bash
git add -A
git commit -m "chore(inspiration): final verification pass" || echo "nothing to commit"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** source→insights→drafts model (Task 1), YouTube+Apple+manual ingest (Tasks 4–5,9), entry A + B (Task 6), resonance via shared profile (Task 7), shared brand voice (Task 3), scrollable wall + semantic search + save/hide + remix (Tasks 10–11), Threads-only output (Task 8), loop-ready ingest unit (Task 9 `runIngest`/`createSourceRow`). Future channel pipeline intentionally NOT built (only groundwork).
- **Type consistency:** `InsightCandidate` fields (`hook/idea/why_share/category`) are identical across extractor, pipeline insert, and UI. `runIngest(sourceId, input)` signature matches its callers (route + smoke script). `scoreResonance(vec, profile)` matches `loadInterestProfile()` return.
- **Known v1 limitations (documented, not bugs):** transcript truncated at 4 chunks (cost guard, logged); resonance is `null` until the trends 👍 profile has ≥ 5 likes; long podcasts produce a long-running background ingest (acceptable on self-hosted launchd).
- **Open confirmations flagged inline:** `withRetry` import path (Task 5), async dynamic-route `params` signature for Next 16 (Task 10 Step 2) — verify against an existing route before relying on them.
