# Substack One-Click Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a button on the episode review page that turns a podcast episode into a tasteful, SEO-tuned "AI FDE essay" Substack draft, reviewable/editable in the dashboard, then copied as rich HTML into Substack.

**Architecture:** A new `substackDraftService` builds an FDE-essay prompt from the episode's Chinese script + source videos (reusing the project's `AI_STYLE_BLACKLIST`), calls the existing `llmService`, and persists a structured draft to a new `substack_drafts` table (one row per episode, regenerable). API routes expose generate / read / update. A client `SubstackDraftSection` renders the draft via `react-markdown`, lets the user edit fields, and copies the rendered body as **rich HTML** (`text/html` to the clipboard — Substack's ProseMirror editor ingests HTML, not raw Markdown) plus a button to open Substack's new-post page.

**Tech Stack:** Next.js 16 (App Router), TypeScript, better-sqlite3, OpenRouter via `llmService`, `react-markdown`. No unit-test framework in this repo — verification is `npm run build` + `npx tsx scripts/test-*.ts` smoke scripts, per CLAUDE.md.

**Spec:** `docs/superpowers/specs/2026-06-23-substack-strategy-design.md`

**Branch:** `feat/substack-draft` (already checked out).

---

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `dashboard/src/db/schema.sql` | Modify | Add `substack_drafts` table + index |
| `dashboard/src/services/substackDraftService.ts` | Create | Build FDE-essay prompt, call LLM, parse JSON, persist + read/update drafts |
| `dashboard/scripts/test-substack-draft.ts` | Create | Smoke test: generate + read-back a draft for a real episode |
| `dashboard/src/app/api/episodes/[id]/substack-draft/route.ts` | Create | `POST` generate (or regenerate) draft for an episode; `GET` current draft |
| `dashboard/src/app/api/substack-drafts/[id]/route.ts` | Create | `GET` + `PATCH` a draft by id (save edits) |
| `dashboard/src/app/episodes/[id]/review/SubstackDraftSection.tsx` | Create | Client UI: generate button, editable fields, markdown preview, copy rich HTML, open Substack |
| `dashboard/src/app/episodes/[id]/review/page.tsx` | Modify | Render `<SubstackDraftSection>` in the review page |

**Working directory for all commands:** `dashboard/` (i.e. `cd dashboard` first).

---

## Task 1: Add `substack_drafts` table

**Files:**
- Modify: `dashboard/src/db/schema.sql` (append a new table near the other content tables, after the `episodes` table block ends at line ~50)

- [ ] **Step 1: Add the table to schema.sql**

Add this block immediately after the `episodes` table definition (after its closing `);`):

```sql
-- Substack draft per episode (one-click "share to Substack" feature)
CREATE TABLE IF NOT EXISTS substack_drafts (
  id INTEGER PRIMARY KEY,
  episode_id INTEGER NOT NULL REFERENCES episodes(id),
  seo_title TEXT,                          -- SEO title (keyword + benefit)
  deck TEXT,                               -- subtitle / thesis preview
  seo_description TEXT,                     -- meta description
  cover_image_url TEXT,                     -- left empty in v1 (manual Canva cover)
  body_markdown TEXT,                       -- article body (Markdown)
  audio_url TEXT,                           -- podcast link for the CTA
  status TEXT NOT NULL DEFAULT 'draft',     -- 'draft' | 'published' (manual flag)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_substack_drafts_episode ON substack_drafts(episode_id);
```

- [ ] **Step 2: Verify the table is created**

`getDb()` runs `schema.sql` on first call. Run:

```bash
cd dashboard && npx tsx -e "import {getDb} from './src/db'; const d=getDb(); console.log(d.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='substack_drafts'\").get())"
```

Expected output: `{ name: 'substack_drafts' }`

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/db/schema.sql
git commit -m "feat(substack): add substack_drafts table"
```

---

## Task 2: `substackDraftService` — types, read, update, mapRow

**Files:**
- Create: `dashboard/src/services/substackDraftService.ts`

- [ ] **Step 1: Create the service with types + persistence helpers (no LLM yet)**

```ts
import { getDb } from '@/db';

export interface SubstackDraft {
  id: number;
  episodeId: number;
  seoTitle: string;
  deck: string;
  seoDescription: string;
  coverImageUrl: string;
  bodyMarkdown: string;
  audioUrl: string;
  status: 'draft' | 'published';
  createdAt: string;
  updatedAt: string;
}

interface DbDraftRow {
  id: number;
  episode_id: number;
  seo_title: string | null;
  deck: string | null;
  seo_description: string | null;
  cover_image_url: string | null;
  body_markdown: string | null;
  audio_url: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapRow(r: DbDraftRow): SubstackDraft {
  return {
    id: r.id,
    episodeId: r.episode_id,
    seoTitle: r.seo_title ?? '',
    deck: r.deck ?? '',
    seoDescription: r.seo_description ?? '',
    coverImageUrl: r.cover_image_url ?? '',
    bodyMarkdown: r.body_markdown ?? '',
    audioUrl: r.audio_url ?? '',
    status: (r.status as 'draft' | 'published') ?? 'draft',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getDraftByEpisode(episodeId: number): SubstackDraft | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM substack_drafts WHERE episode_id = ? ORDER BY id DESC LIMIT 1')
    .get(episodeId) as DbDraftRow | undefined;
  return row ? mapRow(row) : null;
}

export function getDraftById(id: number): SubstackDraft | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM substack_drafts WHERE id = ?').get(id) as
    | DbDraftRow
    | undefined;
  return row ? mapRow(row) : null;
}

/** Update editable fields; only provided keys are written. Returns the updated draft. */
export function updateDraft(
  id: number,
  fields: Partial<Pick<SubstackDraft, 'seoTitle' | 'deck' | 'seoDescription' | 'coverImageUrl' | 'bodyMarkdown' | 'audioUrl' | 'status'>>,
): SubstackDraft | null {
  const db = getDb();
  const map: Record<string, string> = {
    seoTitle: 'seo_title',
    deck: 'deck',
    seoDescription: 'seo_description',
    coverImageUrl: 'cover_image_url',
    bodyMarkdown: 'body_markdown',
    audioUrl: 'audio_url',
    status: 'status',
  };
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, col] of Object.entries(map)) {
    const v = (fields as Record<string, unknown>)[k];
    if (v !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(v);
    }
  }
  if (sets.length === 0) return getDraftById(id);
  sets.push(`updated_at = datetime('now')`);
  vals.push(id);
  db.prepare(`UPDATE substack_drafts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getDraftById(id);
}
```

- [ ] **Step 2: Verify it compiles + read path works**

```bash
cd dashboard && npx tsx -e "import {getDraftByEpisode} from './src/services/substackDraftService'; console.log('ok', getDraftByEpisode(999999))"
```

Expected output: `ok null`

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/services/substackDraftService.ts
git commit -m "feat(substack): draft service types + read/update persistence"
```

---

## Task 3: `substackDraftService` — LLM generation (FDE essay)

**Files:**
- Modify: `dashboard/src/services/substackDraftService.ts`

- [ ] **Step 1: Add imports at the top of the file**

Add below the existing `import { getDb } from '@/db';` line:

```ts
import { getLLMService } from '@/services/llmService';
import { AI_STYLE_BLACKLIST } from '@/services/llm/aiStyleBlacklist';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('substackDraftService');
```

- [ ] **Step 2: Add the prompt builder + JSON parser + generate/upsert function**

Append to the end of the file:

```ts
const SYSTEM_PROMPT = `你是 AI 懶人報的主筆，一位 AI Forward Deployed Engineer。請把一集 podcast 的內容，改寫成一篇要發在 Substack 的繁體中文長文。

風格要求：
- 第一人稱，像一位實踐者在分享自己的 mindset 與踩過的坑——不是新聞轉述、不是工具清單。
- 有結構骨幹（systems thinking），但讀起來像咖啡桌聊天、不是上課；又樂觀又懷疑。
- 參照 One Useful Thing、Latent Space、Chain of Thought 的寫法。
- 標題用挑釁式宣稱 / 反直覺 / 重新定義，不要「今天 5 個工具」這種清單式標題。
- 副標(deck) 一句話講「為什麼這重要」。
- 開場 hook 用具體場景或悖論，不要名詞解釋開頭。
- 正文用 H2（##）分段：現況 → 連到更大的模式 → 給可用的框架；把工具/主題當「論點的證據」帶出，而不是逐條列。
- 收尾留一句可被 restack 的金句。
- 長度約 1500–2500 字。

${AI_STYLE_BLACKLIST}

只輸出 JSON（不要 markdown code fence、不要 JSON 以外任何文字），格式：
{
  "seoTitle": "SEO 標題（關鍵字 + 好處，勿過長）",
  "deck": "副標 / thesis 預告，一句話",
  "seoDescription": "meta description，1–2 句",
  "bodyMarkdown": "正文，Markdown；不要再放 H1 主標，用 ## 分段"
}`;

interface ParsedDraft {
  seoTitle: string;
  deck: string;
  seoDescription: string;
  bodyMarkdown: string;
}

/** Strip ```json fences if present, then JSON.parse. Throws on failure. */
function parseDraftJson(raw: string): ParsedDraft {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  // Fallback: grab the outermost {...} if extra prose leaked in.
  if (!s.startsWith('{')) {
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last !== -1) s = s.slice(first, last + 1);
  }
  const obj = JSON.parse(s);
  return {
    seoTitle: String(obj.seoTitle ?? ''),
    deck: String(obj.deck ?? ''),
    seoDescription: String(obj.seoDescription ?? ''),
    bodyMarkdown: String(obj.bodyMarkdown ?? ''),
  };
}

interface EpisodeRow {
  id: number;
  episode_number: number | null;
  selected_title: string | null;
  script_zh: string | null;
  source_videos: string | null;
  soundon_url: string | null;
  youtube_url: string | null;
}

/**
 * Generate (or regenerate) a Substack draft for an episode.
 * Upserts: replaces the episode's existing draft row if one exists.
 */
export async function generateDraftForEpisode(episodeId: number): Promise<SubstackDraft> {
  const db = getDb();
  const ep = db
    .prepare(
      'SELECT id, episode_number, selected_title, script_zh, source_videos, soundon_url, youtube_url FROM episodes WHERE id = ?',
    )
    .get(episodeId) as EpisodeRow | undefined;
  if (!ep) throw new Error(`Episode ${episodeId} not found`);
  if (!ep.script_zh) throw new Error(`Episode ${episodeId} has no Chinese script (script_zh)`);

  let sourceTitles = '';
  try {
    const vids = JSON.parse(ep.source_videos ?? '[]') as Array<{ title?: string }>;
    sourceTitles = vids.map((v) => v.title).filter(Boolean).join('、');
  } catch {
    /* ignore malformed source_videos */
  }

  const userPrompt = `EP 標題：${ep.selected_title ?? `EP${ep.episode_number ?? ''}`}
來源影片：${sourceTitles || '（無）'}

逐字稿（繁體中文）：
${ep.script_zh}`;

  const llm = getLLMService();
  const res = await llm.call({
    stage: 'substack_draft',
    episodeId,
    episodeNumber: ep.episode_number,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    options: { temperature: 0.8, maxTokens: 4096 },
  });
  if (!res.success || !res.content) {
    throw new Error(`LLM generation failed: ${res.error ?? 'no content'}`);
  }

  const parsed = parseDraftJson(res.content);
  const audioUrl = ep.soundon_url ?? ep.youtube_url ?? '';

  // Upsert: delete any existing draft for this episode, then insert fresh.
  db.prepare('DELETE FROM substack_drafts WHERE episode_id = ?').run(episodeId);
  const info = db
    .prepare(
      `INSERT INTO substack_drafts
        (episode_id, seo_title, deck, seo_description, cover_image_url, body_markdown, audio_url, status)
       VALUES (?, ?, ?, ?, '', ?, ?, 'draft')`,
    )
    .run(
      episodeId,
      parsed.seoTitle,
      parsed.deck,
      parsed.seoDescription,
      parsed.bodyMarkdown,
      audioUrl,
    );

  log.info({ episodeId, draftId: info.lastInsertRowid }, 'Generated Substack draft');
  const draft = getDraftById(Number(info.lastInsertRowid));
  if (!draft) throw new Error('Draft insert failed');
  return draft;
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd dashboard && npm run build 2>&1 | tail -5
```

Expected: build completes (no TypeScript errors referencing `substackDraftService`).

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/services/substackDraftService.ts
git commit -m "feat(substack): LLM draft generation (FDE essay) + upsert"
```

---

## Task 4: Smoke test the generation against a real episode

**Files:**
- Create: `dashboard/scripts/test-substack-draft.ts`

- [ ] **Step 1: Write the smoke script**

```ts
/**
 * Smoke test: generate a Substack draft for the most recent episode that has a
 * Chinese script, then read it back. Run: npx tsx scripts/test-substack-draft.ts
 */
import { getDb } from '../src/db';
import { generateDraftForEpisode, getDraftByEpisode } from '../src/services/substackDraftService';

async function main() {
  const db = getDb();
  const ep = db
    .prepare(
      "SELECT id, episode_number FROM episodes WHERE script_zh IS NOT NULL AND script_zh != '' ORDER BY id DESC LIMIT 1",
    )
    .get() as { id: number; episode_number: number | null } | undefined;
  if (!ep) {
    console.error('No episode with a Chinese script found. Seed an episode first.');
    process.exit(1);
  }

  console.log(`Generating Substack draft for episode ${ep.id} (EP${ep.episode_number})...`);
  const draft = await generateDraftForEpisode(ep.id);

  console.log('\n=== SEO TITLE ===\n' + draft.seoTitle);
  console.log('\n=== DECK ===\n' + draft.deck);
  console.log('\n=== SEO DESCRIPTION ===\n' + draft.seoDescription);
  console.log('\n=== BODY (first 600 chars) ===\n' + draft.bodyMarkdown.slice(0, 600));
  console.log(`\n=== BODY LENGTH: ${draft.bodyMarkdown.length} chars ===`);

  const readBack = getDraftByEpisode(ep.id);
  console.log('\nRead-back id matches:', readBack?.id === draft.id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run the smoke test**

```bash
cd dashboard && npx tsx scripts/test-substack-draft.ts
```

Expected: prints a provocative non-listicle SEO title, a deck, a description, and a 1500–2500-char body in Traditional Chinese; "Read-back id matches: true". Manually eyeball that the body reads like a first-person FDE essay (H2 sections, no "今天 5 個工具" listicle tone, no AI-style clichés).

- [ ] **Step 3: Commit**

```bash
git add dashboard/scripts/test-substack-draft.ts
git commit -m "test(substack): smoke script for draft generation"
```

---

## Task 5: API route — generate + get draft for an episode

**Files:**
- Create: `dashboard/src/app/api/episodes/[id]/substack-draft/route.ts`

- [ ] **Step 1: Write the route (mirrors the regenerate-cover route pattern)**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { generateDraftForEpisode, getDraftByEpisode } from '@/services/substackDraftService';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:substack-draft');

// GET: return the current draft for this episode (or null)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const episodeId = parseInt(id);
  if (isNaN(episodeId)) {
    return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
  }
  return NextResponse.json({ draft: getDraftByEpisode(episodeId) });
}

// POST: generate (or regenerate) the draft for this episode
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const episodeId = parseInt(id);
    if (isNaN(episodeId)) {
      return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
    }

    const db = getDb();
    const episode = db.prepare('SELECT id FROM episodes WHERE id = ?').get(episodeId);
    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    const draft = await generateDraftForEpisode(episodeId);
    log.info({ episodeId, draftId: draft.id }, 'Generated Substack draft via API');
    return NextResponse.json({ draft });
  } catch (err) {
    const message = (err as Error).message;
    log.error({ error: message }, 'Substack draft generation failed');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify build + endpoint (server must be running)**

```bash
cd dashboard && npm run build 2>&1 | tail -3
```

Expected: build passes. (Manual runtime check, if dev server is up: `curl -X POST http://localhost:3000/api/episodes/<id>/substack-draft` returns `{ "draft": { ... } }`.)

- [ ] **Step 3: Commit**

```bash
git add "dashboard/src/app/api/episodes/[id]/substack-draft/route.ts"
git commit -m "feat(substack): API to generate/get episode draft"
```

---

## Task 6: API route — get + update a draft by id

**Files:**
- Create: `dashboard/src/app/api/substack-drafts/[id]/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getDraftById, updateDraft } from '@/services/substackDraftService';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:substack-drafts');

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const draftId = parseInt(id);
  if (isNaN(draftId)) {
    return NextResponse.json({ error: 'Invalid draft id' }, { status: 400 });
  }
  const draft = getDraftById(draftId);
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  return NextResponse.json({ draft });
}

// PATCH: save edited fields. Body may include any of:
// seoTitle, deck, seoDescription, coverImageUrl, bodyMarkdown, audioUrl, status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const draftId = parseInt(id);
    if (isNaN(draftId)) {
      return NextResponse.json({ error: 'Invalid draft id' }, { status: 400 });
    }
    const body = await request.json();
    const allowed = ['seoTitle', 'deck', 'seoDescription', 'coverImageUrl', 'bodyMarkdown', 'audioUrl', 'status'] as const;
    const fields: Record<string, unknown> = {};
    for (const k of allowed) {
      if (typeof body?.[k] === 'string') fields[k] = body[k];
    }
    const draft = updateDraft(draftId, fields);
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    log.info({ draftId, fields: Object.keys(fields) }, 'Updated Substack draft');
    return NextResponse.json({ draft });
  } catch (err) {
    const message = (err as Error).message;
    log.error({ error: message }, 'Substack draft update failed');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify build**

```bash
cd dashboard && npm run build 2>&1 | tail -3
```

Expected: build passes.

- [ ] **Step 3: Commit**

```bash
git add "dashboard/src/app/api/substack-drafts/[id]/route.ts"
git commit -m "feat(substack): API to get/update draft by id"
```

---

## Task 7: Review-page client section (generate, edit, preview, copy rich HTML)

**Files:**
- Create: `dashboard/src/app/episodes/[id]/review/SubstackDraftSection.tsx`

- [ ] **Step 1: Write the client component**

```tsx
'use client';

import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

interface Draft {
  id: number;
  episodeId: number;
  seoTitle: string;
  deck: string;
  seoDescription: string;
  coverImageUrl: string;
  bodyMarkdown: string;
  audioUrl: string;
  status: string;
}

interface Props {
  episodeId: number;
  initialDraft: Draft | null;
}

// AI 懶人報 Substack — opens a fresh newsletter post composer.
const SUBSTACK_NEW_POST_URL = 'https://ailanrenbao.substack.com/publish/post?type=newsletter';

export default function SubstackDraftSection({ episodeId, initialDraft }: Props) {
  const [draft, setDraft] = useState<Draft | null>(initialDraft);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  async function generate() {
    setGenerating(true);
    setError('');
    try {
      const res = await fetch(`/api/episodes/${episodeId}/substack-draft`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Generation failed');
      setDraft(json.draft);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/substack-drafts/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seoTitle: draft.seoTitle,
          deck: draft.deck,
          seoDescription: draft.seoDescription,
          bodyMarkdown: draft.bodyMarkdown,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Save failed');
      setDraft(json.draft);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Copy the RENDERED body as rich HTML so Substack's ProseMirror editor keeps
  // headings/bold/lists/links. Falls back to plain Markdown text if the
  // async Clipboard API is unavailable.
  async function copyRichHtml() {
    if (!draft) return;
    const html = previewRef.current?.innerHTML ?? '';
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([draft.bodyMarkdown], { type: 'text/plain' }),
        }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      await navigator.clipboard.writeText(draft.bodyMarkdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function field(key: keyof Draft, value: string) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  return (
    <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Substack 草稿</h2>
        <button onClick={generate} disabled={generating} style={{ padding: '6px 14px' }}>
          {generating ? '產生中…' : draft ? '重新產生' : '產生 Substack 草稿'}
        </button>
      </div>

      {error && <p style={{ color: '#dc2626', marginTop: 8 }}>{error}</p>}

      {draft && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            <div style={{ fontSize: 12, color: '#6b7280' }}>SEO 標題</div>
            <input
              value={draft.seoTitle}
              onChange={(e) => field('seoTitle', e.target.value)}
              style={{ width: '100%', padding: 6 }}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: '#6b7280' }}>副標 (deck)</div>
            <input
              value={draft.deck}
              onChange={(e) => field('deck', e.target.value)}
              style={{ width: '100%', padding: 6 }}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Meta description</div>
            <input
              value={draft.seoDescription}
              onChange={(e) => field('seoDescription', e.target.value)}
              style={{ width: '100%', padding: 6 }}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: '#6b7280' }}>正文 (Markdown)</div>
            <textarea
              value={draft.bodyMarkdown}
              onChange={(e) => field('bodyMarkdown', e.target.value)}
              rows={16}
              style={{ width: '100%', padding: 6, fontFamily: 'monospace', fontSize: 13 }}
            />
          </label>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={save} disabled={saving}>{saving ? '儲存中…' : '儲存編輯'}</button>
            <button onClick={copyRichHtml}>{copied ? '已複製 ✓' : '複製內容（貼進 Substack）'}</button>
            <a href={SUBSTACK_NEW_POST_URL} target="_blank" rel="noopener noreferrer">
              <button>開啟 Substack 新文章</button>
            </a>
          </div>

          <details>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: '#6b7280' }}>預覽（複製來源）</summary>
            <div
              ref={previewRef}
              style={{ border: '1px solid #f3f4f6', borderRadius: 6, padding: 12, marginTop: 8 }}
            >
              <ReactMarkdown>{draft.bodyMarkdown}</ReactMarkdown>
            </div>
          </details>

          <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
            待你手動在 Substack 後台填：封面圖（Canva 模板）、SEO 標題/描述、內嵌音檔。
          </p>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd dashboard && npm run build 2>&1 | tail -3
```

Expected: build passes.

- [ ] **Step 3: Commit**

```bash
git add "dashboard/src/app/episodes/[id]/review/SubstackDraftSection.tsx"
git commit -m "feat(substack): review-page draft section (edit, preview, copy HTML)"
```

---

## Task 8: Wire the section into the review page

**Files:**
- Modify: `dashboard/src/app/episodes/[id]/review/page.tsx`

- [ ] **Step 1: Add the import**

Add alongside the other section imports (near line 16, where `RegenerateCoverButton` is imported):

```tsx
import SubstackDraftSection from './SubstackDraftSection';
import { getDraftByEpisode } from '@/services/substackDraftService';
```

- [ ] **Step 2: Load the existing draft in the server component**

Inside `ReviewPage`, after the episode is loaded from the DB (where other derived data is prepared, before the `return`), add:

```tsx
  const substackDraft = getDraftByEpisode(episode.id as number);
```

(Use whatever the page's episode-id variable is — it is `episode.id`. If the page already has a numeric `episodeId`, use that instead.)

- [ ] **Step 3: Render the section**

Place this just after the `<RegenerateCoverButton ... />` block in the JSX (around line 269+):

```tsx
          <SubstackDraftSection
            episodeId={episode.id as number}
            initialDraft={substackDraft}
          />
```

- [ ] **Step 4: Verify build**

```bash
cd dashboard && npm run build 2>&1 | tail -3
```

Expected: build passes.

- [ ] **Step 5: Manual end-to-end check (dev server running)**

```bash
cd dashboard && npm run dev
```

Then open `http://localhost:3000/episodes/<id>/review`, scroll to "Substack 草稿":
1. Click "產生 Substack 草稿" → fields + preview populate.
2. Edit the SEO title → "儲存編輯" → reload page → edit persists.
3. Click "複製內容" → paste into a Substack post draft → headings/bold/lists/links preserved.
4. Click "開啟 Substack 新文章" → Substack composer opens in a new tab.

- [ ] **Step 6: Commit**

```bash
git add "dashboard/src/app/episodes/[id]/review/page.tsx"
git commit -m "feat(substack): wire draft section into review page"
```

---

## Self-Review Notes (spec coverage)

- Spec §3.1 flow (button → generate → review → copy-paste): Tasks 5, 7, 8.
- Spec §3.2 data model (`substack_drafts` incl. `deck`): Task 1.
- Spec §3.3 component split (`substackDraftService`, POST/PATCH/GET routes, review UI): Tasks 2–8.
- Spec §3.4 LLM rewrite (FDE essay骨架 + §2.4 語氣 + AI_STYLE_BLACKLIST): Task 3.
- Spec §3.5 copy fidelity (render → copy rich HTML, NOT raw Markdown): Task 7 `copyRichHtml`.
- Spec §2.5 cover (v1 manual, empty `cover_image_url`): Task 1 default + Task 3 inserts `''` + Task 7 reminder line.
- Spec §5 testing (build + smoke script): Task 4 + per-task `npm run build`.

**Out of scope (per spec §4):** unofficial cookie auto-push, cover autofill automation, Notes automation, RSS reverse cross-post. Not in this plan by design.
