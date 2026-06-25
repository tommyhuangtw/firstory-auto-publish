/**
 * Voice writer — generate a Threads post draft in Tommy's voice.
 *
 * bio + style profile are ALWAYS injected. Style examples are retrieved by
 * similarity then engagement. Stories are opt-in, similarity-gated, and the
 * prompt explicitly allows the model to use none — never shoehorn an unrelated
 * anecdote. See spec: docs/superpowers/specs/2026-06-25-voice-writer-design.md
 */

import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { getLLMService } from '@/services/llmService';
import { VERSION_GUARD_ZH } from '@/services/llm/versionGuard';
import { retrieveExamples, retrieveStories } from './retrieval';

const log = createChildLogger('voice:writer');
const MODEL = 'google/gemini-3.1-flash-lite-preview';

/** Fisher-Yates shuffle (in place copy). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

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
}

export interface WriteResult {
  draft: string;
  examples: { text: string; engagement_rate: number; sim: number }[];
  stories: { content: string; sim: number }[];
}

function activeAsset(type: 'bio' | 'style'): string {
  const row = getDb().prepare(
    `SELECT content FROM voice_assets WHERE type = ? AND status != 'hidden' ORDER BY pinned DESC, id DESC LIMIT 1`,
  ).get(type) as { content: string } | undefined;
  return row?.content || '';
}

const RULES = `Threads 貼文規則(嚴格遵守):
- **務必控制在 500 字以內**(Threads 硬上限),盡量精簡有力
- 不要 hashtag、不要連結、不要 markdown 語法(**粗體** 等)
- 口語、對話感,符合他的語氣
- 直接輸出貼文純文字,不要任何前後說明`;

export async function writeThreadsPost(req: WriteRequest): Promise<WriteResult> {
  const bio = activeAsset('bio');
  const style = activeAsset('style');

  // Retrieval query: the idea (rewrite) or topic hint (autonomous); fall back to
  // his core focus when autonomous with no hint.
  const query = req.idea.trim() || 'AI 接案 企業 AI 導入 自動化';

  // Pull a wider relevant×high-engagement pool, then randomly pick 4 so that
  // re-generating the same idea varies the few-shot (and thus the draft).
  const pool = await retrieveExamples(query, 8);
  const examples = shuffle(pool).slice(0, 4);
  const stories = req.useStories ? await retrieveStories(query) : [];

  const exampleBlock = examples.length
    ? `以下是他寫過的高互動貼文,**模仿語氣、節奏、結構,但不要抄內容**:\n\n${examples.map((e, i) => `範例${i + 1}:\n${e.text}`).join('\n\n---\n\n')}`
    : '';

  const storyBlock = stories.length
    ? `\n\n可選的個人故事素材(只在與主題**自然貼合**時才融入;硬湊一個不相關的故事比不用更糟 —— 寧可完全不用):\n${stories.map((s) => `- ${s.content}`).join('\n')}`
    : '';

  const systemPrompt = `你要模仿「湯懶懶 / Tommy」的口吻寫一篇 Threads 貼文。

# 他的背景
${bio || '(無)'}

# 他的寫作風格
${style || '(無)'}

${exampleBlock}${storyBlock}

${RULES}

${VERSION_GUARD_ZH}`;

  const nudge = VARIETY_NUDGES[Math.floor(Math.random() * VARIETY_NUDGES.length)];
  const base = req.mode === 'rewrite'
    ? `請把以下「我的想法」用我的口吻改寫成一篇 Threads 貼文。忠於想法的核心,不要硬加不相關的個人故事:\n\n${req.idea}`
    : `請用我的口吻、在我的主軸(AI 接案 / 企業 AI 導入為主)寫一篇 Threads 貼文。${req.idea.trim() ? `主題/角度:${req.idea}` : '主題自由發揮,挑一個我會感興趣、對讀者有價值的點。'}`;
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

  log.info({ mode: req.mode, examples: examples.length, stories: stories.length }, 'Draft generated');
  return {
    draft: result.content.trim(),
    examples: examples.map((e) => ({ text: e.text, engagement_rate: e.engagement_rate, sim: e.sim })),
    stories: stories.map((s) => ({ content: s.content, sim: s.sim })),
  };
}
