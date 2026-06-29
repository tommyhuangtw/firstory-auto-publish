// dashboard/src/services/resources/scorer.ts
import { getLLMService } from '@/services/llmService';
import { createChildLogger } from '@/lib/logger';
import type { EnrichedResource, ScoredResource } from './types';

const log = createChildLogger('resource-scorer');

const SYSTEM = `你在為「AI 懶人報」篩選值得分享給觀眾的實用資源。觀眾＝正在用 Claude Code / Codex / AI coding agent 的開發者與獨立創作者。對內容評分，四維度加總 100：
1.【實用性／可立即上手】35：能直接接進 workflow、附用法、省時間給高分；純概念低分。
2.【與 AI coding 工作流契合度】30：能跟 Claude Code/Codex/Cursor 直接搭配給高分。
3.【新穎性／隱藏寶藏】20：少人知道的 hidden gem、剛冒出的好工具給高分；老生常談低分。
4.【收藏／話題價值】15：清單型、懶人包、值得收藏給高分。
worthSharing：只有「對 Claude Code/Codex 使用者真的有用」才 true；純新聞/八卦/無法上手的 demo 一律 false。
嚴格輸出 JSON，不要 markdown fence：
{"scores":{"usefulness":0,"fit":0,"novelty":0,"virality":0,"total":0},"reasoning":"具體理由","highlights":["亮點1","亮點2"],"postAngle":"建議切入角度","worthSharing":true}`;

export async function scoreResource(r: EnrichedResource): Promise<ScoredResource> {
  const user = `類型:${r.contentType}\n標題:${r.title}\n描述:${r.description}\n作者:${r.author}\nURL:${r.url}\n` +
    `互動:${JSON.stringify(r.engagement ?? {})}\n星數:${r.stars ?? '-'} 星速度:${r.starVelocity?.toFixed(1) ?? '-'}/day ` +
    `新鮮原因:${r.freshnessReason}`;
  const res = await getLLMService().call({
    stage: 'resource_score',
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
    options: { temperature: 0.3, maxTokens: 800,
      models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3.5-flash'], retryCount: 2, timeoutMs: 30_000 },
  });
  let parsed: Record<string, unknown> = {};
  if (res.success && res.content) {
    const m = res.content.match(/\{[\s\S]*\}/);
    try { parsed = JSON.parse(m ? m[0] : res.content); } catch { /* leave empty */ }
  }
  const scores = (parsed.scores ?? {}) as Record<string, number>;
  return {
    ...r,
    aiScore: Number(scores.total ?? 0),
    aiReasoning: String(parsed.reasoning ?? ''),
    aiHighlights: Array.isArray(parsed.highlights) ? parsed.highlights.map(String) : [],
    aiAngle: String(parsed.postAngle ?? ''),
    worthSharing: parsed.worthSharing === true,
  };
}

/** 併發評分（限流 4）。 */
export async function scoreAll(resources: EnrichedResource[]): Promise<ScoredResource[]> {
  const out: ScoredResource[] = [];
  for (let i = 0; i < resources.length; i += 4) {
    const batch = await Promise.all(resources.slice(i, i + 4).map((r) => scoreResource(r)));
    out.push(...batch);
  }
  log.info({ scored: out.length, worthy: out.filter((r) => r.worthSharing).length }, 'score done');
  return out;
}
