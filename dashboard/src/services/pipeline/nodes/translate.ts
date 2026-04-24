/**
 * Stage 4: Chinese Translation & Localization.
 *
 * Translates English script to Taiwan Traditional Chinese,
 * keeping tool names, platform names, and technical terms in English.
 */

import { getLLMService } from '@/services/llmService';
import { createChildLogger } from '@/lib/logger';
import type { PipelineState } from '../state';

const log = createChildLogger('pipeline:translate');

const TRANSLATE_MODEL = 'google/gemini-2.5-pro';

export async function translate(state: PipelineState): Promise<Partial<PipelineState>> {
  log.info({ wordCount: state.scriptWordCount }, 'Translating to Traditional Chinese');

  if (!state.scriptEn) {
    return { scriptZh: '', status: 'scoring' };
  }

  const llm = getLLMService();

  const result = await llm.call({
    stage: 'script_zh',
    episodeNumber: state.episodeNumber,
    messages: [
      {
        role: 'system',
        content: `You are a professional translator specializing in Taiwan Traditional Chinese (繁體中文).
Your translations sound natural and conversational, like a Taiwanese podcast host speaking to friends.`,
      },
      {
        role: 'user',
        content: buildTranslatePrompt(state.scriptEn),
      },
    ],
    options: {
      preferredModel: TRANSLATE_MODEL,
      maxTokens: 8192,
      temperature: 0.5,
    },
  });

  if (!result.success || !result.content) {
    log.error('Translation failed');
    return { scriptZh: '', status: 'scoring', error: result.error || 'Translation failed' };
  }

  log.info({ length: result.content.length }, 'Translation complete');
  return { scriptZh: result.content, status: 'scoring' };
}

function buildTranslatePrompt(scriptEn: string): string {
  return `Translate the following English podcast script into Taiwan Traditional Chinese (繁體中文).

## Translation Rules:

1. **Keep in English**: Tool names (ChatGPT, Claude, Cursor, etc.), platform names (YouTube, GitHub), technical terms (API, SDK, LLM)
2. **Use Taiwan terminology**:
   - 視頻 → 影片
   - 點贊 → 按讚
   - 帖子 → 貼文
   - 信息 → 資訊
   - 軟件 → 軟體
   - 服務器 → 伺服器
   - 用戶 → 使用者
3. **Tone**: Casual, conversational, like talking to friends. Use 台灣口語 (e.g., 超讚、蠻不錯的、滿屌的)
4. **Length**: 4000-5000 words (Chinese text is naturally shorter than English)
5. **No literal translation** — Adapt idioms and expressions to sound natural in Chinese

## English Script:

${scriptEn}

Output ONLY the translated Chinese script, no meta-commentary.`;
}
