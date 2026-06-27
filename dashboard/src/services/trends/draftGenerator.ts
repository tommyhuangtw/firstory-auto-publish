/**
 * LLM assessment + draft generation for one trending topic.
 * One call returns: 可蹭度 (rideability), risk, a 繁中 viral Threads draft, and a
 * format suggestion (text by default; flags video/webapp when richer wins).
 *
 * The writing rules mirror the episode promo-post generator so drafts keep the
 * same 台灣口語 brand voice and avoid AI-sounding phrasing.
 */

import { getLLMService } from '@/services/llmService';
import { VERSION_GUARD_ZH } from '@/services/llm/versionGuard';
import { createChildLogger } from '@/lib/logger';
import { AUTHOR_VOICE, WRITING_RULES } from '@/services/brandVoice';
import type { RawThreadPost, TrendAssessment, RiskLevel, FormatSuggestion } from './types';

const log = createChildLogger('trend-draft');


const SYSTEM_PROMPT = `你是「AI懶人報」這個帳號的主理人本人，正在 Threads 上經營個人品牌。你的工作是「蹭」當下正在發酵的大眾熱點，寫出一則能爆紅、又跟你的品牌（AI、科技、自動化、生產力、個人成長）能搭得上的貼文。

## 任務
給你一個正在 Threads 上熱門的話題，以及幾則代表性的熱門貼文。你要：
1. 判斷「可蹭度」(rideability, 0-100)：用你的品牌聲音切入這個熱點，能不能寫出有觀點、不尷尬、不硬蹭的好貼文。完全不相關或硬蹭會很尷尬的給低分。
2. 判斷風險 (risk)：這個話題碰了會不會有公關風險（政治、災難、人身攻擊、爭議事件、容易被罵）。low/medium/high，並用一句話說明。
3. 寫一則繁中 Threads 貼文草稿：抓住這個熱點的角度，用你的個人觀點切入，自然、口語、有立場。如果風險高，草稿要走安全、溫和、不選邊站的角度。
4. 建議產出格式 (formatSuggestion)：
   - "text"：純文字貼文就夠（預設，大多數情況）
   - "video"：這題畫面感強、適合做成短影片
   - "webapp"：這題適合做一個可互動的小工具/測驗/網頁來蹭
   - "interactive"：適合做投票、問答等互動貼文
   只有在richer格式明顯會更好時才選 text 以外的，並用一句話說明原因 (formatReason)。

${AUTHOR_VOICE}

${WRITING_RULES}

${VERSION_GUARD_ZH}

## 輸出格式
嚴格輸出 JSON object，不要加 markdown code fence：
{
  "topic": "這則貼文在講的主題/話題，5-12字",
  "rideability": 0-100 的整數,
  "riskLevel": "low" | "medium" | "high",
  "riskReason": "一句話說明風險",
  "draftText": "完整貼文，180-280字（精簡有力，最多不超過 360 字）",
  "formatSuggestion": "text" | "video" | "webapp" | "interactive",
  "formatReason": "若非 text，一句話說明為什麼這個格式更好；若是 text 填空字串"
}`;

function clampRisk(v: unknown): RiskLevel {
  return v === 'high' || v === 'medium' ? v : v === 'low' ? 'low' : 'medium';
}
function clampFormat(v: unknown): FormatSuggestion {
  return v === 'video' || v === 'webapp' || v === 'interactive' ? v : 'text';
}

export async function assessAndDraft(
  posts: RawThreadPost[],
  heatScore: number,
  opinion?: string,
): Promise<TrendAssessment> {
  const samples = posts.slice(0, 3)
    .map((p, i) => `${i + 1}. (讚${p.likeCount}/回${p.replyCount}) ${p.text.slice(0, 240)}`)
    .join('\n');

  const hasOpinion = !!opinion?.trim();
  const opinionBlock = hasOpinion
    ? `\n## 我自己的看法（這是貼文的靈魂，一定要以這個觀點為核心去發揮）\n${opinion!.trim()}\n`
    : '';

  const userPrompt = `## 這則熱門貼文（熱度 ${heatScore}/100）
${samples}
${opinionBlock}
請先判斷這則貼文在講什麼主題，再評估可蹭度與風險，並寫出一則能蹭這個主題的 Threads 貼文。${hasOpinion ? '貼文要以「我的看法」為核心觀點來發揮，用我的風格寫出來。' : ''}`;

  const llm = getLLMService();
  const result = await llm.call({
    stage: 'trend_draft',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    options: {
      temperature: 0.9,
      maxTokens: 1500,
      // flash-lite-3.1 first; on failure fall back to gemini-3.5-flash (NOT Claude — too pricey).
      models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3.5-flash'],
      retryCount: 2,       // fewer retries → fail over to the next model faster
      timeoutMs: 45_000,   // shorter per-request cap for this latency-sensitive stage
    },
  });

  if (!result.success || !result.content) {
    throw new Error(result.error || 'LLM call failed');
  }

  let cleaned = result.content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(objMatch ? objMatch[0] : cleaned) as Record<string, unknown>;

  if (!parsed.draftText || typeof parsed.draftText !== 'string') {
    throw new Error('LLM did not return draftText');
  }

  const assessment: TrendAssessment = {
    topic: String(parsed.topic || '熱門話題').trim().slice(0, 20),
    rideability: Math.max(0, Math.min(100, Math.round(Number(parsed.rideability) || 0))),
    riskLevel: clampRisk(parsed.riskLevel),
    riskReason: String(parsed.riskReason || ''),
    draftText: String(parsed.draftText).trim(),
    formatSuggestion: clampFormat(parsed.formatSuggestion),
    formatReason: String(parsed.formatReason || ''),
  };

  log.info(
    { topic: assessment.topic, rideability: assessment.rideability, risk: assessment.riskLevel, format: assessment.formatSuggestion },
    'Trend draft generated',
  );
  return assessment;
}
