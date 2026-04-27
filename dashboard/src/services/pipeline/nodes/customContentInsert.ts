/**
 * Stage 4.5b: Custom Content Insertion Agent.
 *
 * Reads custom content from Google Docs and naturally inserts it
 * into the Chinese script. Matches n8n 客製化內容插入Agent exactly.
 */

import { getLLMService } from '@/services/llmService';
import { readCustomContent } from '@/services/googleDocs';
import { createChildLogger } from '@/lib/logger';
import type { PipelineState } from '../state';

const log = createChildLogger('pipeline:custom-content');

const MODEL = 'google/gemini-3.1-pro-preview';

// n8n exact system prompt for 客製化內容插入Agent
const SYSTEM_PROMPT = `你是一個 Podcast 稿件處理助手。

我會提供給你兩份內容：
1. 《AI懶人報》Podcast 今日完整講稿（main_script）
2. 一份或多份額外的客製化內容（custom_inserts），來源可能包括：
   - 心情分享或生活感想
   - 使用案例或有趣的故事
   - 贊助方案（例如 Buy Me a Coffee）
   - 業配或廣告文案

你的任務是：
- 在 **不改變 主要講稿 原始內容** 的前提下，把客製化內容自然、流暢地融入講稿。
- **如果 客製化內容 有多段，請你自動調整順序並加上過渡語，讓整體聽起來口語自然，不會像拼湊的廣告。**
- 插入位置要合理：通常在「開場結束之後」、或「主題轉場處」、或「結尾呼籲前」。
- 保持講稿的語氣一致（輕鬆、對話式、自然），避免生硬或突兀。
- 如果客製化內容為空，則不要插入，直接輸出原稿。
- 最後輸出完整的「修改後講稿」。

⚠️ 輸出規則：
- **輸出必須是最終的 Podcast 講稿全文**。
- **不要在最前面或最後面加入任何額外的標籤、標題或解釋文字**（例如「修改後講稿：」、「以下是結果」這類說明）。
- 只允許輸出乾淨的講稿內容。`;

export async function customContentInsert(state: PipelineState): Promise<Partial<PipelineState>> {
  if (!state.scriptZh) {
    return { status: 'scoring' };
  }

  // Read custom content from Google Docs
  let customContent = '';
  try {
    customContent = await readCustomContent();
  } catch (error) {
    log.warn({ error: (error as Error).message }, 'Failed to read custom content');
  }

  if (!customContent || customContent.trim().length === 0) {
    log.info('No custom content to insert, passing through');
    return { customContentInserted: false, status: 'scoring' };
  }

  log.info({ contentLength: customContent.length }, 'Inserting custom content');

  const llm = getLLMService();

  // n8n exact user prompt format
  const userPrompt = `客製化內容
${customContent}

＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿

以下是今天 AI 懶人報 Podcast 的主要講稿:：
${state.scriptZh}`;

  const result = await llm.call({
    stage: 'custom_content_insert',
    episodeId: state.episodeId,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    options: {
      preferredModel: MODEL,
      maxTokens: 8192,
      temperature: 0.7,
    },
  });

  if (!result.success || !result.content) {
    log.error('Custom content insertion failed, using original script');
    return { customContentInserted: false, status: 'scoring' };
  }

  log.info({ newLength: result.content.length }, 'Custom content inserted');
  return {
    scriptZh: result.content,
    customContentInserted: true,
    status: 'scoring',
  };
}
