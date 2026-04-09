/**
 * highlightExtractor.js — Use Gemini (via existing OpenRouterService) to find
 * the best 40-60s highlight in a podcast transcript and produce a script for
 * the hook intro + outro CTA.
 *
 * Output schema:
 *   {
 *     hook_script: string,            // ~8s of narration for sloth avatar at intro
 *     clips: [                        // 1–2 contiguous segments from the original audio
 *       { start: number, end: number, reason: string }
 *     ],
 *     outro_script: string,           // ~8s of narration for sloth avatar at outro
 *     broll_keywords: string[],       // 3–6 visual concepts for stock B-roll
 *     headline: string                // a one-line caption for the highlight
 *   }
 *
 * Falls back to a heuristic stub if OpenRouter is unavailable so the rest of
 * the pipeline can still run during development.
 */

require('dotenv').config();

const HIGHLIGHT_PROMPT_TEMPLATE = ({ transcript, episodeTitle, durationSec }) => `
你是一位專門做 podcast 短影音 (Reels / Shorts) 的剪輯導演。
我會給你一集 podcast 的逐句字幕（含時間戳），請你幫我找出最適合做成 40–60 秒短影音的精華片段。

【節目資訊】
- 節目：AI 懶人報（每日 AI 精華）
- 本集標題：${episodeTitle || '未提供'}
- 總長度：${durationSec.toFixed(0)} 秒

【你的任務】
請輸出一份 **嚴格的 JSON**（不要加 markdown 程式碼框、不要任何說明文字），結構如下：

{
  "hook_script": "（一段 8 秒以內、口語、會讓觀眾停下手指的吸睛開場白，由樹懶主持人來說。中文，台灣口語，避免冗詞）",
  "clips": [
    { "start": 數字(秒), "end": 數字(秒), "reason": "為什麼這段精彩" }
  ],
  "outro_script": "（5–8 秒的 CTA，引導觀眾去聽完整集 / 訂閱頻道，由樹懶主持人說）",
  "broll_keywords": ["3–6 個視覺關鍵字", "用英文，給 stock 影片庫搜尋用", "..."],
  "headline": "一句 12 字以內的中文標題，會浮在影片上方"
}

【嚴格規則】
1. clips 加總長度必須在 32–48 秒之間（給 hook + outro 留 12–18 秒空間，總片長 40–60 秒）。
2. clips 必須是原 transcript 中真實存在的時段；start/end 對齊到段落邊界。
3. 最多 2 段 clip，能用 1 段就 1 段，但若有兩段都很精彩可以拆。
4. hook_script 不要劇透精華內容，要製造好奇。
5. outro_script 結尾必須出現「完整集數連結在資訊欄」這類引導。
6. broll_keywords 用英文（Pexels 用），且要具體可搜（例：「typing on laptop」「ai robot humanoid」）。
7. 只輸出 JSON，不要任何前後說明。

【字幕（含時間戳）】
${transcript}
`.trim();

/**
 * @param {object} args
 * @param {import('./transcribe').TranscriptionResult} args.transcription
 * @param {string} [args.episodeTitle]
 * @returns {Promise<HighlightPlan>}
 */
async function extractHighlight({ transcription, episodeTitle }) {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('⚠️  [highlight] OPENROUTER_API_KEY not set — returning STUB highlight plan');
    return makeStubPlan(transcription);
  }

  // Lazy require so the module loads even if openRouterService throws on missing key
  const { OpenRouterService } = require('../openRouterService');
  const openRouter = new OpenRouterService();

  const transcriptText = formatTranscriptForPrompt(transcription);
  const prompt = HIGHLIGHT_PROMPT_TEMPLATE({
    transcript: transcriptText,
    episodeTitle,
    durationSec: transcription.duration || 0,
  });

  console.log('🧠 [highlight] Asking Gemini to find the best 40–60s clip...');
  const result = await openRouter.generateJSON(prompt, {
    temperature: 0.5,
    maxTokens: 2048,
  });

  if (!result.success || !result.data) {
    console.warn('⚠️  [highlight] LLM failed, falling back to stub plan:', result.error);
    return makeStubPlan(transcription);
  }

  return validateAndNormalize(result.data, transcription);
}

function formatTranscriptForPrompt(transcription) {
  return (transcription.segments || [])
    .map(s => `[${fmtTime(s.start)} → ${fmtTime(s.end)}] ${s.text.trim()}`)
    .join('\n');
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

function validateAndNormalize(plan, transcription) {
  const totalDuration = transcription.duration || 0;
  const clips = (plan.clips || [])
    .filter(c => typeof c.start === 'number' && typeof c.end === 'number')
    .map(c => ({
      start: Math.max(0, c.start),
      end: Math.min(totalDuration || c.end, c.end),
      reason: c.reason || '',
    }))
    .filter(c => c.end > c.start);

  return {
    hook_script: plan.hook_script || '哈囉，我是樹懶，今天有件事你一定要知道。',
    clips: clips.length ? clips : makeStubPlan(transcription).clips,
    outro_script: plan.outro_script || '想聽完整內容，記得點下方資訊欄連結，按下訂閱不迷路。',
    broll_keywords: Array.isArray(plan.broll_keywords) && plan.broll_keywords.length
      ? plan.broll_keywords
      : ['ai technology', 'typing on laptop', 'futuristic interface'],
    headline: plan.headline || '本集精華',
  };
}

/**
 * Deterministic stub: pick the middle ~40s of the transcript.
 */
function makeStubPlan(transcription) {
  const total = transcription.duration || 60;
  const targetLen = Math.min(40, Math.max(20, total * 0.6));
  const start = Math.max(0, (total - targetLen) / 2);
  const end = Math.min(total, start + targetLen);

  return {
    hook_script: '哈囉我是樹懶，這集我要告訴你一個你絕對不能錯過的 AI 大消息！',
    clips: [{ start, end, reason: '(stub) middle slice of episode' }],
    outro_script: '想聽完整集，記得點資訊欄連結，按下訂閱不迷路！',
    broll_keywords: ['ai robot', 'typing on laptop', 'futuristic interface', 'data visualization'],
    headline: '本集精華',
    _stub: true,
  };
}

module.exports = { extractHighlight, makeStubPlan };
