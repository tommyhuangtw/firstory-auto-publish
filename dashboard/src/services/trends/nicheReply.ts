/**
 * Niche reply generation — write a REPLY (not a new post) to someone else's
 * niche Threads post, in Tommy's voice. Goal: genuine engagement in his niche
 * (AI tools / freelancing / startup / AI learning) so the reply gets seen by
 * strangers and builds trust. See spec:
 * docs/superpowers/specs/2026-06-26-trends-reply-zone-design.md
 */

import { createChildLogger } from '@/lib/logger';
import { getLLMService } from '@/services/llmService';
import { VERSION_GUARD_ZH } from '@/services/llm/versionGuard';
import { ANTI_AI_VOICE } from '@/services/brandVoice';
import { activeAsset, cleanAIVoice } from '@/services/voice/writer';

const log = createChildLogger('trend-reply');
const MODEL = 'google/gemini-3.1-flash-lite-preview';

export interface NichePostForReply {
  author?: string | null;
  text: string;
}

/** Generate a reply draft (Tommy's voice) for one niche post. */
export async function generateNicheReply(post: NichePostForReply): Promise<string> {
  const bio = activeAsset('bio');
  let style = activeAsset('style');
  if (!style) {
    // No personal style asset yet — fall back to the brand voice so replies aren't voiceless.
    const { AUTHOR_VOICE, WRITING_RULES } = await import('@/services/brandVoice');
    style = `${AUTHOR_VOICE}\n\n${WRITING_RULES}`;
  }

  const systemPrompt = `你要用「湯懶懶 / Tommy」的口吻,對 Threads 上「別人的一則貼文」寫一則**回覆**(不是寫新貼文)。目的是在他的利基(AI 工具 / 接案 / 創業 / AI 學習)真誠互動、被陌生人看到、建立信任。

# 他的背景
${bio || '(無)'}

# 他的寫作風格(口吻)
${style || '(無)'}

# 回覆原則
- 先判斷對方貼文的類型,對症下藥:
  - 求助 / 提問 → 給「實用、具體」的解答或方向
  - 觀點 / 心得 → 補一個他的角度、經驗或延伸,呼應但要有增量
  - AI 焦慮 / 迷惘 → 先同理,再給一個務實的方向
- **長度:多數情況用 1-3 句、約 100 字內**回完就好,精簡、真誠、口語(回覆不是寫文章)。只有當這則貼文真的有料、值得深聊時,才展開成一小段有洞見的回覆 —— 絕不為長而長
- 緊扣「對方說的內容」回應,不要答非所問、不要硬塞自己想講的
- **絕不推銷、不自我宣傳、不要 hashtag / 連結 / markdown**
- 直接輸出回覆純文字,不要任何前後說明

${ANTI_AI_VOICE}

${VERSION_GUARD_ZH}`;

  const userPrompt = `對方的貼文${post.author ? `(@${post.author})` : ''}:\n\n${post.text}\n\n請寫一則你會留在這則貼文底下的回覆。`;

  const llm = getLLMService();
  const r = await llm.call({
    stage: 'trend_reply',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    options: { preferredModel: MODEL, maxTokens: 1024, temperature: 0.8 },
  });
  if (!r.success || !r.content) throw new Error(r.error || 'reply generation failed');
  const reply = await cleanAIVoice(r.content.trim(), llm);
  log.info({ author: post.author }, 'Niche reply generated');
  return reply;
}
