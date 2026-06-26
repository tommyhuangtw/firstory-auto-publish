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
import { retrieveStories } from './retrieval';
import { scoreDrafts, type DraftScore } from './predictorClient';

// Tommy's own account handle — anchors the predictor to his personal baseline.
const PERSONAL_AUTHOR = 'ai.lanrenbao';

const log = createChildLogger('voice:writer');
const MODEL = 'google/gemini-3.1-flash-lite-preview';
const MAX_LEN = 500; // Threads hard limit (characters)

// Rotating "angle" nudges so re-generating the same idea yields fresh drafts.
const VARIETY_NUDGES = [
  '這次用一個跟你以往不同的開場方式,給點新鮮感。',
  '這次試著用一個提問或反直覺的點切入。',
  '這次用比較故事感、生活化的方式開場。',
  '這次開門見山、直接拋出核心觀點。',
  '這次的節奏可以更輕快、更口語一點。',
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
- 開頭第一行 ≤25 字就要有鉤子。優先:反差宣告(「我把 ___ 刪掉了」)、數字/結果前置(「我把 ___ 從 X 變成 Y」)、或脆弱自白(先講低谷)。禁止「今天想跟大家分享」這種暖場。
- 第一人稱 + 至少一個具體數字(天數/金額/百分比/次數);把「很有效」換成可量化結果。
- 一句一行、多用空行,手機上有呼吸感;正文精簡。
- 鎖定「一個」主要情緒(好奇/共鳴/不甘/爽感/反差),不要一篇想做到全部。
- 方法/工具當配角,主角是「我達成了什麼」;能演成一個小場景更好。
- 結尾二選一:開放提問(衝回覆)或互惠型 CTA(「想要細節留言我整理給你 / 收藏起來」);不要乞求按讚追蹤。
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

const RULES = `寫作規則(嚴格遵守):
- **一篇只聚焦 1-2 個重點 / mindset**,講深、不貪多,不要塞一堆主題
- 用他的「語氣與思考方式」表達,但要**延伸出一個『新的』觀點/角度**,不是重組他寫過的東西
- **絕不重用**他過去的開場白、口頭禪、招牌金句、或具體故事;讀者看過他的舊文,任何似曾相識的套路都會讓人膩
- **目標 350-450 字,絕對不可超過 500 字**(Threads 硬上限);寧可精簡也不要超字
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

  const systemPrompt = `你要用「湯懶懶 / Tommy」的口吻寫一篇 Threads 貼文。你的任務是用他的**語氣和思考方式**,延伸出一個**新的觀點**,不是重組或複述他寫過的內容。

# 他的背景
${bio || '(無)'}

# 他的寫作風格(這是「怎麼說」的機制,照這個語氣寫;裡面不該、也不要出現任何招牌金句)
${style || '(無)'}${backgroundBlock}

${RULES}
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
  // Hard guarantee on the Threads length limit: the model often overshoots the
  // prompt's target, so compress in one pass if it's still over. Count by code
  // points (not UTF-16 units) so emoji aren't double-counted vs Threads' limit.
  if (codePointLen(draft) > MAX_LEN) {
    draft = await compressToLimit(draft, llm);
  }

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

/** Compress an over-length draft to ≤480 chars, preserving hook/point/ending. */
async function compressToLimit(draft: string, llm: ReturnType<typeof getLLMService>): Promise<string> {
  const r = await llm.call({
    stage: 'voice_write_compress',
    messages: [
      {
        role: 'system',
        content: '你是文字編輯。把這篇 Threads 貼文精簡到 **480 字以內**(務必),保留開頭的 hook、核心觀點、和結尾的 CTA/提問,維持一句一行的口語節奏。不要新增內容、不要改變立場或語氣。直接輸出精簡後的純文字,不要任何說明。',
      },
      { role: 'user', content: draft },
    ],
    options: { preferredModel: MODEL, maxTokens: 1024, temperature: 0.3 },
  });
  const out = (r.success && r.content) ? r.content.trim() : draft;
  // Last-resort hard cut if the compressor still overshot. Slice by code points
  // so we never split an emoji's surrogate pair (which would emit a broken char).
  const cps = [...out];
  return cps.length > MAX_LEN ? cps.slice(0, MAX_LEN).join('') : out;
}

/** Character count by code point (emoji = 1), matching Threads' limit better than UTF-16 .length. */
function codePointLen(s: string): number {
  return [...s].length;
}
