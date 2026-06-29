import { getDb } from '@/db';
import { getLLMService } from '@/services/llmService';
import { AI_STYLE_BLACKLIST } from '@/services/llm/aiStyleBlacklist';
import { findImage, findImageCandidate } from '@/services/unsplashService';
import { generateSlothIllustration } from '@/services/slothIllustrationService';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('substackDraftService');

/**
 * One image embedded in the body, tracked so it can be regenerated/re-fetched.
 * - type 'sloth': an AI 湯懶懶 illustration (brief = scene description; no attribution).
 * - type 'photo': an Unsplash photo (query + candidate index + attribution).
 */
export interface DraftImage {
  type: 'sloth' | 'photo';
  query: string; // sloth: scene brief; photo: search keywords
  index: number; // photo: which Unsplash candidate is shown (cycling); sloth: 0
  url: string; // current image URL (also the anchor used to locate it in the body)
  alt: string;
  photographer: string; // photo only
  photographerUrl: string; // photo only
  photoUrl: string; // photo only
}

export interface SubstackDraft {
  id: number;
  episodeId: number;
  seoTitle: string;
  deck: string;
  seoDescription: string;
  coverImageUrl: string;
  bodyMarkdown: string;
  images: DraftImage[];
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
  images_json: string | null;
  audio_url: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapRow(r: DbDraftRow): SubstackDraft {
  let images: DraftImage[] = [];
  try {
    if (r.images_json) {
      images = (JSON.parse(r.images_json) as DraftImage[]).map((im) => ({
        ...im,
        type: im.type ?? 'photo', // back-compat: pre-hybrid drafts were all photos
      }));
    }
  } catch {
    /* malformed → no images */
  }
  return {
    id: r.id,
    episodeId: r.episode_id,
    seoTitle: r.seo_title ?? '',
    deck: r.deck ?? '',
    seoDescription: r.seo_description ?? '',
    coverImageUrl: r.cover_image_url ?? '',
    bodyMarkdown: r.body_markdown ?? '',
    images,
    audioUrl: r.audio_url ?? '',
    status: (r.status as 'draft' | 'published') ?? 'draft',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Build the markdown block for one image.
 * - sloth: just the image (no attribution needed for our own illustration).
 * - photo: image + "Photo by … on Unsplash" attribution (required by Unsplash API terms).
 */
function imageBlock(img: DraftImage): string {
  if (img.type === 'sloth') {
    return `![${img.alt}](${img.url})`;
  }
  return (
    `![${img.alt}](${img.url})\n\n` +
    `*Photo by [${img.photographer}](${img.photographerUrl}) on [Unsplash](${img.photoUrl})*`
  );
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
- 圖片：你要當「美術指導」，但原則是「**圖要支持文章裡的洞見或數據，不是為做而做**」：
  1. 先在心裡找出全篇最值得視覺化的「洞見」或「具體數據」（數字、前後對比、機制、反直覺的點）。
  2. 只挑最能視覺化的 **1–2 個** 放圖，放在「那個洞見／數據被討論到」的段落之間，「獨立一行」放標記。**有值得的才放；真的沒有就少放或不放，不要湊數。**（一般文章至少會有 1 個值得視覺化的點。）
  - **預設、首選**：品牌編輯插畫，格式 \`[[SLOTH: 中文brief]]\`。brief 要寫清楚：**(a) 這張圖要凸顯哪個洞見／數據 + (b) 怎麼把它視覺化讓人一眼看懂**（圖表／前後對比／關鍵大數字／機制示意），最後補一句湯懶懶當「專業但可愛的小配角」在旁引導／反應（比例小、不搶戲）。**不要**耍廢元素。**第一張圖用 SLOTH**。格式範例（僅示意，請依『本篇實際的洞見／數據』來寫，不要照抄範例文字）：\`[[SLOTH: 凸顯某個關鍵數據——用陡升折線圖配上該數字的大字；湯懶懶在一角專業地指著轉折點]]\`
  - **少數情況**：當洞見牽涉「具體真實世界的東西」（真實硬體/晶片/資料中心、真實地點、實體產品），用照片更有說服力時，格式 \`[[PHOTO: 英文搜尋關鍵字]]\`。**整篇最多 1 張 PHOTO**。

${AI_STYLE_BLACKLIST}

📝 長文專屬（書面排版，podcast 講稿不適用）：
- 破折號（——）少用，多用句號或逗號斷開；不要每個轉折都用破折號製造戲劇感
- 粗體只保留必要的定義或關鍵詞，不要機械式地把短語加粗強調
- 不要用「儘管面臨種種挑戰…但展望未來…」這種公式化的「挑戰＋樂觀結尾」段落，改成具體、有時間點的事實
- 收尾金句要「賺來的」：用具體、有觀點的一句收（值得 restack）；但別硬湊空洞的格言腔（聽起來很可引用卻沒講出東西的那種），那種就改回白話

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

/** Resolve one marker to a DraftImage (sloth illustration or Unsplash photo). */
async function resolveOne(type: 'sloth' | 'photo', text: string): Promise<DraftImage | null> {
  if (type === 'sloth') {
    try {
      const url = await generateSlothIllustration(text);
      return { type: 'sloth', query: text, index: 0, url, alt: '湯懶懶插畫', photographer: '', photographerUrl: '', photoUrl: '' };
    } catch (err) {
      log.warn({ error: (err as Error).message, brief: text }, 'Sloth illustration failed');
      return null;
    }
  }
  const img = await findImage(text);
  return img ? { type: 'photo', query: text, index: 0, ...img } : null;
}

/**
 * Replace [[SLOTH: brief]] / [[PHOTO: query]] markers in the body with real images.
 * Hybrid: 湯懶懶 illustrations by default, Unsplash photos for concrete subjects.
 * Caps: ≤2 images total, ≤1 photo. Unresolvable markers are dropped so the essay
 * still ships. Resolution runs in parallel (sloth generation is slow). Returns the
 * rewritten body plus tracked images (for later regenerate/swap).
 */
async function resolveImages(body: string): Promise<{ body: string; images: DraftImage[] }> {
  const markers = [...body.matchAll(/\[\[(SLOTH|PHOTO):\s*([^\]]+)\]\]/g)];
  if (markers.length === 0) return { body, images: [] };

  // Decide which markers to keep (order preserved): ≤2 total, ≤1 photo.
  const kept: { raw: string; type: 'sloth' | 'photo'; text: string }[] = [];
  let photos = 0;
  for (const m of markers) {
    const type = m[1] === 'SLOTH' ? 'sloth' : 'photo';
    if (kept.length >= 2) break;
    if (type === 'photo' && photos >= 1) continue;
    if (type === 'photo') photos++;
    kept.push({ raw: m[0], type, text: m[2].trim() });
  }

  // Resolve kept markers concurrently.
  const resolved = await Promise.all(kept.map((k) => resolveOne(k.type, k.text)));

  // Replace each marker (kept→image or '', dropped/overflow→'').
  let result = body;
  const images: DraftImage[] = [];
  const keptRaw = new Set(kept.map((k) => k.raw));
  kept.forEach((k, i) => {
    const img = resolved[i];
    const replacement = img ? `\n\n${imageBlock(img)}\n\n` : '';
    if (img) images.push(img);
    result = result.replace(k.raw, replacement);
  });
  // Strip any markers we didn't keep (over the cap).
  for (const m of markers) {
    if (!keptRaw.has(m[0])) result = result.replace(m[0], '');
  }

  log.info({ markers: markers.length, used: images.length }, 'Resolved article images');
  return { body: result, images };
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
  const { body: bodyMarkdown, images } = await resolveImages(parsed.bodyMarkdown);
  const audioUrl = ep.soundon_url ?? ep.youtube_url ?? '';

  // Upsert: delete any existing draft for this episode, then insert fresh.
  db.prepare('DELETE FROM substack_drafts WHERE episode_id = ?').run(episodeId);
  const info = db
    .prepare(
      `INSERT INTO substack_drafts
        (episode_id, seo_title, deck, seo_description, cover_image_url, body_markdown, images_json, audio_url, status)
       VALUES (?, ?, ?, ?, '', ?, ?, ?, 'draft')`,
    )
    .run(
      episodeId,
      parsed.seoTitle,
      parsed.deck,
      parsed.seoDescription,
      bodyMarkdown,
      JSON.stringify(images),
      audioUrl,
    );

  log.info({ episodeId, draftId: info.lastInsertRowid }, 'Generated Substack draft');
  const draft = getDraftById(Number(info.lastInsertRowid));
  if (!draft) throw new Error('Draft insert failed');
  return draft;
}

/**
 * Swap one image in a draft.
 * - `currentUrl` identifies which image to replace.
 * - `newText`: for a photo → new keywords; for a sloth → new scene brief. Optional.
 * sloth: regenerate the illustration (with the new/old brief).
 * photo: re-search with new keywords, or advance to the next candidate.
 * Updates both the body markdown and the tracked images metadata.
 */
export async function swapDraftImage(
  draftId: number,
  currentUrl: string,
  newText?: string,
): Promise<SubstackDraft> {
  const draft = getDraftById(draftId);
  if (!draft) throw new Error(`Draft ${draftId} not found`);

  const i = draft.images.findIndex((im) => im.url === currentUrl);
  if (i === -1) throw new Error('找不到要替換的圖片');
  const old = draft.images[i];

  let next: DraftImage;
  if (old.type === 'sloth') {
    const brief = newText?.trim() || old.query;
    const url = await generateSlothIllustration(brief);
    next = { type: 'sloth', query: brief, index: 0, url, alt: '湯懶懶插畫', photographer: '', photographerUrl: '', photoUrl: '' };
  } else {
    const query = newText?.trim() || old.query;
    const nextIndex = newText?.trim() ? 0 : old.index + 1;
    const found = await findImageCandidate(query, nextIndex);
    if (!found) throw new Error('Unsplash 找不到新圖片（可能是關鍵字無結果或未設定金鑰）');
    next = { type: 'photo', query, index: nextIndex, ...found };
  }

  // Replace in body: prefer the exact old block; fall back to swapping the URL
  // + caption links individually (covers the case where the user edited the body).
  let body = draft.bodyMarkdown;
  const oldBlock = imageBlock(old);
  const newBlock = imageBlock(next);
  if (body.includes(oldBlock)) {
    body = body.replace(oldBlock, newBlock);
  } else if (body.includes(old.url)) {
    body = body
      .split(old.url).join(next.url)
      .split(old.photographerUrl).join(next.photographerUrl)
      .split(old.photoUrl).join(next.photoUrl)
      .split(`[${old.photographer}]`).join(`[${next.photographer}]`);
  } else {
    throw new Error('內文裡找不到這張圖片（可能已被手動刪除）');
  }

  const images = [...draft.images];
  images[i] = next;

  getDb()
    .prepare(`UPDATE substack_drafts SET body_markdown = ?, images_json = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(body, JSON.stringify(images), draftId);

  log.info({ draftId, type: old.type, query: next.query, index: next.index }, 'Swapped Substack draft image');
  const updated = getDraftById(draftId);
  if (!updated) throw new Error('Draft reload failed');
  return updated;
}
