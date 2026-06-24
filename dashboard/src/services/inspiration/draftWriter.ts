import { getLLMService } from '@/services/llmService';
import { AUTHOR_VOICE, WRITING_RULES } from '@/services/brandVoice';
import { VERSION_GUARD_ZH } from '@/services/llm/versionGuard';

const SYSTEM_PROMPT = `你是「AI懶人報」帳號的主理人本人，正在 Threads 上經營個人品牌。我會給你一個 insight（一個心法/觀點），以及我自己想補充的經驗或角度。你要用我的品牌聲音，把它寫成一則能讓人有收穫、想分享的 Threads 貼文。

不要只是覆述 insight，要用我的角度重新詮釋，加入具體的生活感與觀點。

${AUTHOR_VOICE}

${WRITING_RULES}

${VERSION_GUARD_ZH}

直接輸出貼文純文字，不要任何解釋、不要 JSON、不要標題。`;

export interface InsightForDraft {
  hook: string;
  idea: string;
  why_share?: string | null;
}

/** Write one Threads draft from an insight + Tommy's optional note. */
export async function writeInsightPost(insight: InsightForDraft, userNote?: string): Promise<string> {
  const noteBlock = userNote?.trim()
    ? `\n## 我自己想補充的經驗 / 角度（這是貼文的靈魂，請以此為核心發揮）\n${userNote.trim()}\n`
    : '';
  const userPrompt = `## Insight\nhook：${insight.hook}\nidea：${insight.idea}${insight.why_share ? `\n為什麼值得分享：${insight.why_share}` : ''}\n${noteBlock}\n請寫成一則 Threads 貼文。`;

  const llm = getLLMService();
  const r = await llm.call({
    stage: 'inspiration_draft',
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }],
    options: { temperature: 0.9, maxTokens: 1500, models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3.5-flash'], retryCount: 2, timeoutMs: 45_000 },
  });
  if (!r.success || !r.content) throw new Error(r.error || 'LLM draft failed');
  return r.content.trim();
}
