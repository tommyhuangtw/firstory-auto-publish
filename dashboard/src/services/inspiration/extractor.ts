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
