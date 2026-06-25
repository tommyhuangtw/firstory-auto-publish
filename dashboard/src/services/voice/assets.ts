/**
 * Threads Voice Corpus — voice asset generation.
 *
 * Distils the Threads post corpus into editable assets:
 *   - bio   : who Tommy is / what he does (single asset)
 *   - style : a concise style guide (single asset)
 *   - story : personal anecdotes extracted from posts, topic-tagged (many)
 *
 * All generated assets are status='draft'. Regeneration replaces only
 * non-pinned drafts of the requested type, so the user's kept/pinned/edited
 * assets survive. See spec:
 * docs/superpowers/specs/2026-06-25-threads-voice-corpus-design.md
 */

import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { getLLMService } from '@/services/llmService';

const log = createChildLogger('voice:assets');

const QUALITY_MODEL = 'google/gemini-3.1-pro-preview';
const FAST_MODEL = 'google/gemini-2.5-flash';

// Channel focus + story taxonomy (from spec / Tommy's direction).
const CHANNEL_FOCUS = `頻道主軸是「AI 接案」與「企業 AI 導入」,這是最主要的內容。其餘(職場、英國生活、美國/求學經歷)是豐富個人色彩的輔助素材。`;
export const STORY_TAGS = ['ai-freelance', 'enterprise-adoption', 'workplace', 'uk-life', 'us-school', 'other'] as const;

interface PostRow { post_id: string; text: string; engagement_rate: number; posted_at: string | null }

/** Strip ```json fences and parse, returning [] on failure. */
function parseJsonArray(raw: string): unknown[] {
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  try {
    const v = JSON.parse(cleaned);
    return Array.isArray(v) ? v : [];
  } catch {
    // try to salvage the first [...] block
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* give up */ } }
    return [];
  }
}

/** Delete regenerable (draft, un-pinned) assets of a type so regeneration is idempotent. */
function clearDrafts(type: string): void {
  getDb().prepare(`DELETE FROM voice_assets WHERE type = ? AND status = 'draft' AND pinned = 0`).run(type);
}

function insertAsset(type: string, content: string, opts: { tags?: string[]; sourcePostId?: string } = {}): void {
  getDb().prepare(`
    INSERT INTO voice_assets (type, content, topic_tags, source_post_id, status)
    VALUES (?, ?, ?, ?, 'draft')
  `).run(type, content, opts.tags ? JSON.stringify(opts.tags) : null, opts.sourcePostId ?? null);
}

/** Representative sample for style/bio: top by engagement + most recent, deduped. */
function loadStyleSample(limit = 70): PostRow[] {
  const db = getDb();
  const half = Math.floor(limit / 2);
  const top = db.prepare(`
    SELECT post_id, text, engagement_rate, posted_at FROM threads_posts
    WHERE is_repost = 0 AND length(text) > 40
    ORDER BY engagement_rate DESC LIMIT ?
  `).all(half) as PostRow[];
  const recent = db.prepare(`
    SELECT post_id, text, engagement_rate, posted_at FROM threads_posts
    WHERE is_repost = 0 AND length(text) > 40
    ORDER BY posted_at DESC LIMIT ?
  `).all(limit - half) as PostRow[];
  const seen = new Set<string>();
  const out: PostRow[] = [];
  for (const p of [...top, ...recent]) {
    if (seen.has(p.post_id)) continue;
    seen.add(p.post_id);
    out.push(p);
  }
  return out;
}

/** Generate the style profile (single 'style' draft asset). */
export async function generateStyleProfile(): Promise<string> {
  const sample = loadStyleSample();
  if (sample.length === 0) throw new Error('No posts to analyze — run sync first');

  const corpus = sample.map((p, i) => `[${i + 1}] ${p.text}`).join('\n\n');
  const llm = getLLMService();
  const result = await llm.call({
    stage: 'voice_style_profile',
    messages: [
      {
        role: 'system',
        content: `你是一位資深文案編輯,要從一位創作者的 Threads 貼文中,萃取出他「可轉移的寫作語氣機制」,讓 AI 用他的口吻去寫**全新主題**的文章。

${CHANNEL_FOCUS}

⚠️ 最重要:我們要的是「他怎麼說」的**抽象機制**,不是他說過的具體內容。
- ❌ 不要列出任何招牌金句、口頭禪、簽名句、或任何可被直接照抄的句子
- ❌ 不要引用他寫過的具體故事、案例、或經歷
- ✅ 只描述抽象、可套用到**任何主題**的語氣與結構手法

請輸出一份精簡、可操作的風格指南(繁體中文),涵蓋:
- 語氣與態度(他給人的感覺、立場傾向)
- 句構與節奏(長短句比例、段落習慣、標點、是否單句成段)
- 開場的「手法類型」(例如:提問式、反直覺斷言、場景帶入——只描述手法類型,不要寫出具體例句)
- 收尾的「手法類型」(例如:拋問題、行動呼籲)
- 用詞風格層級(正式/口語、是否愛用比喻、技術詞怎麼處理——描述傾向,不要列特定詞)
- emoji 使用習慣(頻率、位置、風格)
- 典型貼文長度

用條列式、**抽象**、可直接當寫作指令的描述。不要客套、不要逐篇分析、**不要任何可被照抄的具體句子或詞**。`,
      },
      { role: 'user', content: `以下是貼文樣本:\n\n${corpus}` },
    ],
    options: { preferredModel: QUALITY_MODEL, maxTokens: 2048, temperature: 0.4 },
  });

  if (!result.success || !result.content) throw new Error(`Style profile failed: ${result.error}`);
  clearDrafts('style');
  insertAsset('style', result.content.trim());
  log.info('Style profile generated');
  return result.content.trim();
}

/** Suggest a bio/background (single 'bio' draft asset). */
export async function suggestBio(): Promise<string> {
  const sample = loadStyleSample(50);
  if (sample.length === 0) throw new Error('No posts to analyze — run sync first');

  const corpus = sample.map((p) => p.text).join('\n\n---\n\n');
  const llm = getLLMService();
  const result = await llm.call({
    stage: 'voice_bio',
    messages: [
      {
        role: 'system',
        content: `根據這位創作者的 Threads 貼文,推測並寫出一段「個人背景檔」,給 AI 寫作時當常駐 context 用。

${CHANNEL_FOCUS}

請用繁體中文寫一段精簡的背景描述,涵蓋:他是誰、在做什麼、專業領域、立場/觀點傾向、最常談的主題。第三人稱、150-250 字、具體不空泛。直接輸出背景檔內文,不要前後綴。`,
      },
      { role: 'user', content: `貼文樣本:\n\n${corpus}` },
    ],
    // QUALITY_MODEL spends "thinking" tokens that count toward maxTokens; keep
    // generous headroom so the (short) bio output isn't truncated mid-sentence.
    options: { preferredModel: QUALITY_MODEL, maxTokens: 2048, temperature: 0.5 },
  });

  if (!result.success || !result.content) throw new Error(`Bio generation failed: ${result.error}`);
  clearDrafts('bio');
  insertAsset('bio', result.content.trim());
  log.info('Bio suggested');
  return result.content.trim();
}

/** Extract personal stories from the corpus (many 'story' draft assets). */
export async function extractStories(): Promise<number> {
  const db = getDb();
  // Candidates: substantive, first-person-capable posts (not reposts, not one-liners).
  const candidates = db.prepare(`
    SELECT post_id, text, engagement_rate, posted_at FROM threads_posts
    WHERE is_repost = 0 AND length(text) > 80
    ORDER BY posted_at DESC
  `).all() as PostRow[];

  if (candidates.length === 0) return 0;

  const llm = getLLMService();
  const CHUNK = 40;
  let extracted = 0;
  clearDrafts('story');

  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    const listing = chunk.map((p, idx) => `[${idx + 1}] ${p.text}`).join('\n\n');

    const result = await llm.call({
      stage: 'voice_stories',
      messages: [
        {
          role: 'system',
          content: `你要從一批 Threads 貼文中,挑出含有「個人親身小故事/案例」的貼文,抽取成可複用的故事素材。

「個人小故事/案例」= 帶有作者第一人稱親身經歷 + 具體情境 + 個人觀點/心得的內容,主要涵蓋:
- AI 接案心得(接案過程、與客戶互動、踩雷/成功案例)
- 企業 AI 導入心得
- 職場心得
- 英國生活心得
- 美國 / 求學經歷

不算故事的:純資訊轉述、工具介紹/教學、純宣傳推銷、單純心情短句、沒有具體經歷的觀點。

對每一篇「符合」的貼文,輸出一個物件:
{ "index": 編號, "story": "用 1-3 句話精煉這則個人故事/案例的核心(繁中)", "tags": [從這些選: ai-freelance, enterprise-adoption, workplace, uk-life, us-school, other] }

只輸出 JSON 陣列(沒有符合就回 [])。不要任何說明文字。`,
        },
        { role: 'user', content: listing },
      ],
      options: { preferredModel: FAST_MODEL, maxTokens: 4096, temperature: 0.3 },
    });

    if (!result.success || !result.content) {
      log.warn({ chunkStart: i }, 'Story extraction chunk failed, skipping');
      continue;
    }

    const items = parseJsonArray(result.content);
    for (const item of items as Array<{ index?: number; story?: string; tags?: string[] }>) {
      const idx = (item.index ?? 0) - 1;
      if (idx < 0 || idx >= chunk.length || !item.story) continue;
      const validTags = (item.tags || []).filter((t) => (STORY_TAGS as readonly string[]).includes(t));
      insertAsset('story', item.story.trim(), {
        tags: validTags.length ? validTags : ['other'],
        sourcePostId: chunk[idx].post_id,
      });
      extracted++;
    }
    log.info({ chunkStart: i, runningTotal: extracted }, 'Story chunk done');
  }

  log.info({ extracted }, 'Story extraction complete');
  return extracted;
}

/** Generate all voice assets (bio + style + stories) from the current corpus. */
export async function generateAllAssets(): Promise<{ style: boolean; bio: boolean; stories: number }> {
  const style = await generateStyleProfile().then(() => true).catch((e) => { log.error({ e: e.message }, 'style failed'); return false; });
  const bio = await suggestBio().then(() => true).catch((e) => { log.error({ e: e.message }, 'bio failed'); return false; });
  const stories = await extractStories().catch((e) => { log.error({ e: e.message }, 'stories failed'); return 0; });
  // Embed the freshly extracted stories so the writer can retrieve them.
  try {
    const { backfillEmbeddings } = await import('./embeddings');
    await backfillEmbeddings();
  } catch (e) { log.warn({ e: (e as Error).message }, 'embedding backfill after asset gen failed'); }
  return { style, bio, stories };
}
