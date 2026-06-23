import { getDb } from '@/db';
import { getLLMService } from '@/services/llmService';
import { AI_STYLE_BLACKLIST } from '@/services/llm/aiStyleBlacklist';
import { findImage } from '@/services/unsplashService';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('substackDraftService');

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
- **務必**在文章中插入 **1–2 張**圖片（這是必要的、不可省略）：在最適合的 section 之間，獨立一行放圖片標記，格式為 [[IMG: 英文圖片搜尋關鍵字]]（描述畫面氛圍/主題，例：[[IMG: software engineer working late night warm desk]]）。關鍵字一定要用英文，挑能呼應該段主題、有質感的畫面。

${AI_STYLE_BLACKLIST}

請「嚴格」用下列格式輸出（不要 JSON、不要 code fence、不要多餘說明）。前三行各一行，正文放在 ===BODY=== 之後，可多行：

SEO_TITLE: <SEO 標題，關鍵字 + 好處，勿過長，單行>
DECK: <副標 / thesis 預告，一句話，單行>
SEO_DESCRIPTION: <meta description，1–2 句，單行>
===BODY===
<正文，Markdown；不要再放 H1 主標，用 ## 分段>`;

interface ParsedDraft {
  seoTitle: string;
  deck: string;
  seoDescription: string;
  bodyMarkdown: string;
}

/**
 * Parse the delimited draft format (SEO_TITLE/DECK/SEO_DESCRIPTION lines + ===BODY===).
 * This avoids JSON's "raw newline inside string literal" failures on long markdown.
 * Falls back to legacy JSON parsing if the model ignored the format and returned JSON.
 */
function parseDraft(raw: string): ParsedDraft {
  let s = raw.trim();
  const fence = s.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();

  const bodyIdx = s.search(/^===BODY===\s*$/m);
  if (bodyIdx !== -1) {
    const header = s.slice(0, bodyIdx);
    const body = s.replace(/^[\s\S]*?^===BODY===\s*$/m, '').trim();
    const grab = (label: string): string => {
      const m = header.match(new RegExp(`^${label}:\\s*(.+)$`, 'mi'));
      return m ? m[1].trim() : '';
    };
    return {
      seoTitle: grab('SEO_TITLE'),
      deck: grab('DECK'),
      seoDescription: grab('SEO_DESCRIPTION'),
      bodyMarkdown: body,
    };
  }

  // Legacy fallback: model returned JSON. Grab outermost {...} and parse.
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

/**
 * Replace [[IMG: query]] markers in the body with real Unsplash images
 * (markdown image + attribution caption). Caps at 2 images. Markers that can't
 * be resolved (no key / no result) are simply removed so the essay still ships.
 */
async function resolveImages(body: string): Promise<string> {
  const markers = [...body.matchAll(/\[\[IMG:\s*([^\]]+)\]\]/g)];
  if (markers.length === 0) return body;

  let result = body;
  let used = 0;
  for (const m of markers) {
    let replacement = '';
    if (used < 2) {
      const img = await findImage(m[1].trim());
      if (img) {
        replacement =
          `\n\n![${img.alt}](${img.url})\n\n` +
          `*Photo by [${img.photographer}](${img.photographerUrl}) on [Unsplash](${img.photoUrl})*\n\n`;
        used++;
      }
    }
    result = result.replace(m[0], replacement);
  }
  log.info({ markers: markers.length, used }, 'Resolved Unsplash images');
  return result;
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
    // Long-form generation → use the project's script/content workhorse model
    // (gemini-2.5-flash stopped mid-essay; sonnet exceeds the 90s timeout on big inputs).
    // Generous token budget + timeout for a 1500–2500 字 essay.
    options: {
      temperature: 0.8,
      maxTokens: 8192,
      preferredModel: 'google/gemini-3.1-pro-preview',
      timeoutMs: 120_000,
    },
  });
  if (!res.success || !res.content) {
    throw new Error(`LLM generation failed: ${res.error ?? 'no content'}`);
  }

  const parsed = parseDraft(res.content);
  const bodyMarkdown = await resolveImages(parsed.bodyMarkdown);
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
      bodyMarkdown,
      audioUrl,
    );

  log.info({ episodeId, draftId: info.lastInsertRowid }, 'Generated Substack draft');
  const draft = getDraftById(Number(info.lastInsertRowid));
  if (!draft) throw new Error('Draft insert failed');
  return draft;
}
