/**
 * Voice writer (v2) — generate a Threads post draft in Tommy's voice.
 *
 * Voice comes ONLY from the distilled bio + style profile (the "how he says
 * things", abstract — no catchphrases). We deliberately do NOT few-shot raw
 * past posts: that made the model copy his openings/phrases/stories. Stories
 * are opt-in background memory (to inform perspective), never retold by default.
 * The output must extend a NEW mindset, focused on 1-2 points.
 * See spec: docs/superpowers/specs/2026-06-26-voice-writer-v2-design.md
 */

import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { getLLMService } from '@/services/llmService';
import { VERSION_GUARD_ZH } from '@/services/llm/versionGuard';
import { ANTI_AI_VOICE, findBannedTerms } from '@/services/brandVoice';
import { retrieveStories } from './retrieval';
import { scoreDrafts, type DraftScore } from './predictorClient';

// Tommy's own account handle — anchors the predictor to his personal baseline.
const PERSONAL_AUTHOR = 'ai.lanrenbao';

const log = createChildLogger('voice:writer');
const MODEL = 'google/gemini-3.1-flash-lite-preview';
const MAX_LEN = 500; // Threads hard limit (characters / code points)
const COMPRESS_TRIGGER = 290; // over this → compress down (keep drafts 中短, ~180-280)
const COMPRESS_TARGET = 200; // ask the compressor for this; the model always overshoots ~50-60, so undershoot lands ~中短

// Rotating hook×structure combos so re-generating yields fresh, well-shaped drafts.
// Each pairs a HOOK strategy (how to open) with a STRUCTURE (how the body unfolds).
// These are Threads-appropriate and stay in his honest voice — NOT hype/clickbait.
const VARIETY_NUDGES = [
  '開場用「反差宣告」(一句跟多數人想的相反的斷言),正文走短故事弧:我遇到的狀況 → 轉折 → 收一個觀點。',
  '開場用「具體數字/結果前置」(把可量化的成果放第一句),正文用 Before→After 對比帶出心法。',
  '開場用「脆弱自白」(先講我卡關或做錯的低谷),再翻到我學到什麼,結尾拋一個開放問題。',
  '開場用「好奇缺口」(點出一個被忽略、反常識的點,但先不講破),正文一步步揭開。',
  '開場「開門見山」直接拋核心觀點(金句型、精簡),正文只補 1-2 句佐證,刻意留白讓人想回應。',
  '開場用「場景帶入」(我看到/聽到的一個具體畫面),自然滑進我的觀察與立場。',
];

export interface WriteRequest {
  mode: 'rewrite' | 'autonomous';
  idea: string;
  useStories: boolean;
  viral?: boolean;
}

// High-leverage rules distilled from 12k high-engagement Threads posts.
// See: dashboard/data/research/threads-viral-playbook.md
const VIRAL_PLAYBOOK = `🔥 爆文模式 — 套用高流量 Threads 寫法,但**不可犧牲真實感與他的口吻**:
- ⭐ 成效定義:Threads/Meta 演算法裡「讚」幾乎沒權重。真正驅動擴散的排序是「私訊分享 > 儲存 > 5 字以上的長留言 > 公開分享」,而且第 1 小時的互動決定擴散。所以這篇要為「值得被收藏 / 想轉給朋友 / 忍不住想留一句」而寫,不是為了被按讚。
- 開頭第一行 ≤25 字就要有鉤子。優先:反差宣告(「我把 ___ 刪掉了」)、數字/結果前置(「我把 ___ 從 X 變成 Y」)、或脆弱自白(先講低谷)。禁止「今天想跟大家分享」這種暖場。
- 第一人稱 + 至少一個具體數字(天數/金額/百分比/次數);把「很有效」換成可量化結果。
- 一句一行、多用空行,手機上有呼吸感;正文精簡。
- 鎖定「一個」主要情緒,並用對的手法去觸發:好奇=資訊缺口先不講破 / 共鳴=脆弱自白+可帶入的具體細節 / 不甘=反差+證據 / 爽感=成果+具體數字 / 反差=反常識斷言。不要一篇想做到全部。
- 方法/工具當配角,主角是「我達成了什麼」;能演成一個小場景更好。
- 結尾 CTA 三選一(對症下藥,且要「互惠」不是「乞求」):
  · 衝留言+收藏:給可索取的東西 →「留言『關鍵字』我整理給你 / 傳你」,把懶人包或連結放留言區讓人自取(不要群發私訊,會被判濫用)。
  · 衝回覆:拋一個具體、好回答的開放問題(「你會選 X 還是 Y?」),不要空泛的「你覺得呢?」。
  · 衝儲存:結尾收一句「值得收藏、下次用得上」的實用句。
  絕不乞求按讚或追蹤。
- 真實感優先:具體、敢點真名、可保留一句小坦白;絕不淪為樣板推銷文(讀者一眼看穿會反感)。`;

export interface WriteResult {
  draft: string;
  stories: { content: string; sim: number }[];
  /** Predictor score for this draft (null if the scoring service is offline). */
  score?: DraftScore | null;
}

/** A best-of-N result: the chosen (highest-scoring) draft plus the ranked rest. */
export interface BestOfNResult {
  best: WriteResult;
  /** All candidates, ranked best→worst by viral_prob. Includes `best` at [0]. */
  candidates: WriteResult[];
  /** False when the predictor was offline and we fell back to the first draft. */
  scored: boolean;
}

/** The active (pinned-first, non-hidden) bio or style asset, or '' if none. Shared with the niche reply writer. */
export function activeAsset(type: 'bio' | 'style'): string {
  const row = getDb().prepare(
    `SELECT content FROM voice_assets WHERE type = ? AND status != 'hidden' ORDER BY pinned DESC, id DESC LIMIT 1`,
  ).get(type) as { content: string } | undefined;
  return row?.content || '';
}

/**
 * Freshness gate: the opening snippets of recently-written drafts (inspiration +
 * trends, last 14 days). Fed to the model as "you already wrote these — vary the
 * angle" so it doesn't keep recycling the same hook/topic across sessions.
 */
function recentAngles(limit = 12): string[] {
  try {
    const rows = getDb().prepare(
      `SELECT draft_text FROM (
         SELECT draft_text, created_at FROM insight_drafts WHERE created_at > datetime('now','-14 days')
         UNION ALL
         SELECT draft_text, created_at FROM trend_drafts   WHERE created_at > datetime('now','-14 days')
       ) ORDER BY created_at DESC LIMIT ?`,
    ).all(limit) as { draft_text: string }[];
    return rows
      .map((r) => [...(r.draft_text || '')].slice(0, 36).join('').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  } catch {
    return []; // tables missing / fresh DB — freshness gate is best-effort
  }
}

const RULES = `寫作規則(嚴格遵守):
- **一篇只聚焦 1-2 個重點 / mindset**,講深、不貪多,不要塞一堆主題
- 用他的「語氣與思考方式」表達,但要**延伸出一個『新的』觀點/角度**,不是重組他寫過的東西
- **絕不重用**他過去的開場白、口頭禪、招牌金句、或具體故事;讀者看過他的舊文,任何似曾相識的套路都會讓人膩
- **目標 180-280 字,精簡有力**;最多不要超過 360 字,寧可精簡也不要冗長(Threads 上限 500 字)
- 結尾要能引發互動:拋一個具體、好回答的開放問題,或收一句「值得收藏、下次用得上」的實用句。記住 Threads 上「讚」幾乎沒權重,真正讓貼文擴散的是被收藏 / 被私訊轉發 / 引出留言 —— 為這些而寫,不要為按讚而寫,也不要乞求按讚追蹤
- 不要 hashtag、不要連結、不要 markdown 語法(**粗體** 等)
- 直接輸出貼文純文字,不要任何前後說明`;

export async function writeThreadsPost(req: WriteRequest, nudgeIndex?: number): Promise<WriteResult> {
  const bio = activeAsset('bio');
  let style = activeAsset('style');
  // Fallback: if the personal style asset hasn't been generated yet (corpus not
  // synced, or all assets hidden), use the brand voice so drafts are never voiceless.
  if (!style) {
    const { AUTHOR_VOICE, WRITING_RULES } = await import('@/services/brandVoice');
    style = `${AUTHOR_VOICE}\n\n${WRITING_RULES}`;
  }

  const query = req.idea.trim() || 'AI 接案 企業 AI 導入 自動化';
  const stories = req.useStories ? await retrieveStories(query) : [];

  // Stories are BACKGROUND memory (to inform perspective), not material to retell.
  const backgroundBlock = stories.length
    ? `\n\n# 關於他的背景記憶(僅供你理解他的視角與經歷,**不要在文章裡複述這些故事**,除非主題自然需要而他本人會想提):\n${stories.map((s) => `- ${s.content}`).join('\n')}`
    : '';

  // Freshness: list recent openings so the model picks a different angle/hook.
  const recent = recentAngles();
  const freshnessBlock = recent.length
    ? `\n\n# 你最近已經寫過這些(開頭節錄),**換個主題或角度、別重複套路**:\n${recent.map((a) => `- ${a}…`).join('\n')}`
    : '';

  const systemPrompt = `你要用「湯懶懶 / Tommy」的口吻寫一篇 Threads 貼文。你的任務是用他的**語氣和思考方式**,延伸出一個**新的觀點**,不是重組或複述他寫過的內容。

# 他的背景
${bio || '(無)'}

# 他的寫作風格(這是「怎麼說」的機制,照這個語氣寫;裡面不該、也不要出現任何招牌金句)
${style || '(無)'}${backgroundBlock}${freshnessBlock}

${RULES}

${ANTI_AI_VOICE}
${req.viral ? `\n${VIRAL_PLAYBOOK}\n` : ''}
${VERSION_GUARD_ZH}`;

  // best-of-N passes an explicit index so each candidate gets a distinct angle;
  // single-draft calls (nudgeIndex undefined) stay random for freshness.
  const nudge = nudgeIndex == null
    ? VARIETY_NUDGES[Math.floor(Math.random() * VARIETY_NUDGES.length)]
    : VARIETY_NUDGES[nudgeIndex % VARIETY_NUDGES.length];
  const base = req.mode === 'rewrite'
    ? `這是我想分享的重點 / mindset:\n\n${req.idea}\n\n請用我的口吻,聚焦這 1-2 個重點,延伸寫成一篇 Threads 貼文。`
    : `請用我的口吻寫一篇 Threads 貼文。${req.idea.trim() ? `這是今天想寫的 mindset / 角度:\n${req.idea}` : '從我的主軸(AI 接案 / 企業 AI 導入)挑一個我會有感、對讀者有價值的點切入。'}`;
  const userPrompt = `${base}\n\n（${nudge}）`;

  const llm = getLLMService();
  const result = await llm.call({
    stage: 'voice_write',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    options: { preferredModel: MODEL, maxTokens: 2048, temperature: 0.95 },
  });

  if (!result.success || !result.content) {
    throw new Error(`Draft generation failed: ${result.error}`);
  }

  let draft = result.content.trim();
  // Keep drafts 中短: the model often overshoots the prompt's target, so if it ran
  // long, compress it down to TARGET_MAX in one pass (rather than shipping a wall of
  // text or chopping it mid-sentence). Count by code points (not UTF-16 units) so
  // emoji aren't double-counted vs Threads' limit.
  if (codePointLen(draft) > COMPRESS_TRIGGER) {
    draft = await compressToLimit(draft, llm);
  }

  // Deterministic AI-voice filter (the prompt blocklist isn't airtight at high temp).
  draft = await cleanAIVoice(draft, llm);

  log.info({ mode: req.mode, stories: stories.length, len: codePointLen(draft) }, 'Draft generated');
  return {
    draft,
    stories: stories.map((s) => ({ content: s.content, sim: s.sim })),
  };
}

/**
 * Generate N drafts (distinct angles), score each with the like-predictor, and
 * return the highest-scoring one plus the ranked alternatives. This is the
 * agent "self-tune" loop: write several, keep the one most likely to 爆.
 *
 * Ranking key = viral_prob (primary), relative_score (tiebreaker). If the
 * scoring service is offline, falls back to the first draft (scored=false).
 */
export async function writeBestOfN(req: WriteRequest, n = 5): Promise<BestOfNResult> {
  const count = Math.max(1, Math.min(n, VARIETY_NUDGES.length));
  // Generate candidates concurrently, each with its own angle.
  const drafts = await Promise.all(
    Array.from({ length: count }, (_, i) => writeThreadsPost(req, i)),
  );

  const scores = await scoreDrafts(drafts.map((d) => d.draft), PERSONAL_AUTHOR);
  if (!scores) {
    log.warn('predictor offline — returning first draft unscored');
    return { best: drafts[0], candidates: drafts, scored: false };
  }

  const ranked = drafts
    .map((d, i) => ({ ...d, score: scores[i] }))
    .sort((a, b) => {
      const dv = (b.score!.viralProb) - (a.score!.viralProb);
      return dv !== 0 ? dv : (b.score!.relativeScore) - (a.score!.relativeScore);
    });

  log.info(
    { n: count, bestViral: ranked[0].score?.viralProb, worstViral: ranked[count - 1].score?.viralProb },
    'best-of-N scored',
  );
  return { best: ranked[0], candidates: ranked, scored: true };
}

/**
 * Deterministic AI-voice cleanup, shared by the post writer and the reply writer:
 * always strip Unicode emoji; if any high-confidence banned term survived the prompt
 * blocklist, run ONE targeted repair pass (only fires on a hit, so cost stays low).
 */
export async function cleanAIVoice(text: string, llm: ReturnType<typeof getLLMService>): Promise<string> {
  let out = scrubEmoji(text);
  const banned = findBannedTerms(out);
  if (banned.length) {
    out = scrubEmoji(await repairBanned(out, banned, llm));
    const still = findBannedTerms(out);
    if (still.length) log.warn({ still }, 'Banned AI-voice terms persisted after repair');
  }
  return out;
}

/** Strip Unicode emoji / pictographs (brand voice = no emoji; XD & text emoticons stay). */
function scrubEmoji(s: string): string {
  return s
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Targeted rewrite: swap the flagged AI-voice terms for concrete colloquial wording,
 *  changing nothing else. Only called when findBannedTerms() actually hit. */
async function repairBanned(draft: string, hits: string[], llm: ReturnType<typeof getLLMService>): Promise<string> {
  const r = await llm.call({
    stage: 'voice_write_scrub',
    messages: [
      {
        role: 'system',
        content: `這篇 Threads 貼文用到了 AI 味很重、很假的詞或句式:「${hits.join('」「')}」。請在**完全不改變意思、立場、語氣、長度、換行**的前提下,只把這些詞/句式換成具體、口語、台灣人日常會講的說法,其他一個字都不要動。直接輸出修好的純文字,不要任何說明。`,
      },
      { role: 'user', content: draft },
    ],
    options: { preferredModel: MODEL, maxTokens: 1024, temperature: 0.4 },
  });
  return (r.success && r.content) ? r.content.trim() : draft;
}

/** Compress an over-length draft to 中短 (~230), preserving hook/point/ending. */
async function compressToLimit(draft: string, llm: ReturnType<typeof getLLMService>): Promise<string> {
  const r = await llm.call({
    stage: 'voice_write_compress',
    messages: [
      {
        role: 'system',
        content: `你是文字編輯。把這篇 Threads 貼文精簡到 **${COMPRESS_TARGET} 字以內**(務必,寧短勿長),保留開頭的 hook、核心觀點、和結尾的 CTA/提問,維持一句一行的口語節奏。不要新增內容、不要改變立場或語氣。直接輸出精簡後的純文字,不要任何說明。`,
      },
      { role: 'user', content: draft },
    ],
    options: { preferredModel: MODEL, maxTokens: 1024, temperature: 0.3 },
  });
  const out = (r.success && r.content) ? r.content.trim() : draft;
  // Last-resort safety net (compressor still overshot the Threads hard limit):
  // trim at a sentence boundary so we never ship a half-sentence ("喀掉").
  return trimToSentence(out, MAX_LEN);
}

/**
 * Trim to ≤ `limit` code points WITHOUT cutting mid-sentence: fall back to the
 * last sentence boundary (。！？.!?… or newline) before the limit. Only hard-cuts
 * (by code point, so emoji surrogate pairs stay intact) if there's no boundary at all.
 */
function trimToSentence(text: string, limit: number): string {
  const cps = [...text];
  if (cps.length <= limit) return text;
  const head = cps.slice(0, limit).join('');
  const m = head.match(/^[\s\S]*[。！？!?…\n]/);
  return (m ? m[0] : head).trim();
}

/** Character count by code point (emoji = 1), matching Threads' limit better than UTF-16 .length. */
function codePointLen(s: string): number {
  return [...s].length;
}
