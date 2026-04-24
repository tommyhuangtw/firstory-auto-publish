/**
 * Stage 6: Generate Meta — Titles, Description, Tags.
 *
 * Ported from src/services/contentGenerator.js.
 * Generates 10 title candidates, selects best, creates description and tags.
 */

import { getLLMService } from '@/services/llmService';
import { createChildLogger } from '@/lib/logger';
import type { PipelineState } from '../state';

const log = createChildLogger('pipeline:meta');

export async function generateMeta(state: PipelineState): Promise<Partial<PipelineState>> {
  log.info('Generating metadata (titles, description, tags)');

  const content = state.scriptZh || state.scriptEn || '';
  if (!content) {
    return { status: 'tts', error: 'No script content for meta generation' };
  }

  const llm = getLLMService();
  const isRobot = state.segmentType === 'robot';

  // Step 1: Generate 10 title candidates
  const titlesResult = await llm.generateJSON<{ titles: string[] }>(
    isRobot ? buildRobotTitlePrompt(content) : buildTitlePrompt(content),
    'title_gen',
    { episodeNumber: state.episodeNumber, maxTokens: 2048, temperature: 0.7 }
  );

  const candidateTitles = titlesResult.success && titlesResult.data?.titles
    ? titlesResult.data.titles
    : getFallbackTitles();

  log.info({ count: candidateTitles.length }, 'Title candidates generated');

  // Step 2: Select best title
  const selectResult = await llm.generateJSON<{ bestIndex: number; bestTitle: string }>(
    buildTitleSelectionPrompt(candidateTitles, content.slice(0, 1000)),
    'title_select',
    { episodeNumber: state.episodeNumber, maxTokens: 512, temperature: 0.3 }
  );

  let selectedTitle = candidateTitles[0];
  if (selectResult.success && selectResult.data) {
    const idx = (selectResult.data.bestIndex || 1) - 1;
    if (idx >= 0 && idx < candidateTitles.length) {
      selectedTitle = candidateTitles[idx];
    }
  }

  log.info({ selectedTitle: selectedTitle.slice(0, 50) }, 'Title selected');

  // Step 3: Generate description
  const descResult = await llm.generateJSON<{ description: string }>(
    isRobot ? buildRobotDescriptionPrompt(content) : buildDescriptionPrompt(content),
    'description_gen',
    { episodeNumber: state.episodeNumber, maxTokens: 1024, temperature: 0.7 }
  );

  const description = descResult.success && descResult.data?.description
    ? descResult.data.description
      .replace(/.*drive\.google\.com.*\n?/g, '')
      .replace(/.*點擊這裡收聽.*\n?/g, '')
      .trim()
    : getFallbackDescription();

  // Step 4: Generate tags
  const tagsResult = await llm.generateJSON<{ tags: string[] }>(
    buildTagsPrompt(content, selectedTitle),
    'tags_gen',
    { episodeNumber: state.episodeNumber, maxTokens: 512, temperature: 0.5 }
  );

  const tags = tagsResult.success && tagsResult.data?.tags
    ? tagsResult.data.tags
    : getFallbackTags();

  log.info({ descLength: description.length, tagCount: tags.length }, 'Meta generation complete');

  return {
    candidateTitles,
    selectedTitle,
    description,
    tags,
    status: 'tts',
  };
}

// ── Prompt Builders (ported from contentGenerator.js) ──

function buildTitlePrompt(content: string): string {
  return `你是一位經驗豐富的 Podcast 製作人，深知如何吸引觀眾眼光、提高點擊率。請根據以下內容生成10個吸引人的標題。

內容摘要：
${content.slice(0, 3000)}

標題要求：
1. 每個標題聚焦一個清晰的核心主題
2. 包含 1-2 個觀眾最感興趣的 AI 工具名稱
3. 標題長度 35-45 字
4. 使用臺灣繁體中文用語
5. 不要加 EPxx 集數編號
6. 不要加類型標記（如【資訊型】）

風格涵蓋：資訊型、幽默型、誇張型、對話式

以 JSON 格式回傳：
{ "titles": ["標題1", "標題2", ..., "標題10"] }`;
}

function buildRobotTitlePrompt(content: string): string {
  return `你是一位專注於機器人科技的 Podcast 製作人。請根據以下「機器人觀察週報」內容生成10個標題。

內容摘要：
${content.slice(0, 3000)}

標題要求：
1. 聚焦機器人趨勢、技術突破或產業動態
2. 包含 1-2 個機器人品牌/公司名（Tesla Optimus, Figure, Boston Dynamics, Unitree 等）
3. 標題長度 35-45 字
4. 使用臺灣繁體中文
5. 不要加 EPxx 或類型標記

以 JSON 格式回傳：
{ "titles": ["標題1", ..., "標題10"] }`;
}

function buildTitleSelectionPrompt(titles: string[], content: string): string {
  const titleList = titles.map((t, i) => `${i + 1}. ${t}`).join('\n');
  return `從以下10個標題中選出最佳 Podcast 標題。

候選標題：
${titleList}

內容摘要：
${content}

評選標準：點擊吸引力 > 內容相關度 > 品牌知名度 > 情感驅動 > 搜尋友善

以 JSON 格式回傳：
{ "bestIndex": 1, "bestTitle": "完整標題", "reason": "理由" }`;
}

function buildDescriptionPrompt(content: string): string {
  return `根據以下內容生成 Podcast 描述，包含5個 AI 工具。

內容摘要：
${content.slice(0, 3000)}

格式：
開頭段落（包含"全都交給 AI"和"精選 5 支熱門 AI 工具"）🚀

💡 工具名稱：功能亮點
👉 應用場景和價值

（重複5次）

要求：200-350字、輕鬆有趣、不含外部連結

以 JSON 格式回傳：
{ "description": "完整描述" }`;
}

function buildRobotDescriptionPrompt(content: string): string {
  return `根據以下「機器人觀察週報」內容生成 Podcast 描述，包含5個機器人趨勢亮點。

內容摘要：
${content.slice(0, 3000)}

格式：
開頭段落（點出本週機器人圈重大趨勢）🤖

💡 亮點名稱：事件或突破
👉 產業影響或未來展望

（重複5次）

要求：200-350字、輕鬆但有科技觀點、不含外部連結

以 JSON 格式回傳：
{ "description": "完整描述" }`;
}

function buildTagsPrompt(content: string, title: string): string {
  return `你是 YouTube SEO 專家。根據以下 Podcast 內容和標題，生成 YouTube tags。

標題：${title}
內容摘要：${content.slice(0, 2000)}

要求：
1. 20-30 個 tags
2. 包含品牌 tag（AI懶人報）、工具名稱、技術關鍵字
3. 混合繁體中文 + English
4. 從廣泛到具體排序

以 JSON 格式回傳：
{ "tags": ["tag1", "tag2", ...] }`;
}

// ── Fallbacks ──

function getFallbackTitles(): string[] {
  return [
    'AI 工具界核彈級更新！ChatGPT、Claude、Gemini 三強爭霸',
    'OpenAI 放大招！GPT-5 功能曝光，Claude 緊急應戰',
    'Google Gemini 2.0 狂飆升級！免費超越 GPT-4',
    'AI 副業爆發中！ChatGPT + Claude 月入 10 萬攻略',
    'Meta 推出免費 AI 神器！挑戰 OpenAI 霸主地位',
  ];
}

function getFallbackDescription(): string {
  return `從找創業點子到打造 App，全都交給 AI！今天幫你精選 5 支熱門 AI 工具影片，讓寫程式變得跟玩一樣簡單 🚀

💡 ChatGPT Advanced：程式碼生成再進化，寫 App 像寫作文
👉 全新程式模式支援多語言開發，初學者也能 30 分鐘做出原型！

💡 Claude 3.5 Sonnet：AI 寫程式的天花板，Bug 偵測神準
👉 上傳截圖自動生成前端代碼，設計稿秒變真實網頁！

💡 Cursor IDE：AI 編程助手內建，寫程式效率翻 10 倍
👉 智能補全、自動重構、Bug 修復，連資深工程師都在用！

💡 Replit Agent：零基礎做 App 的最佳選擇
��� 描述需求就能生成完整專案，部署上線一鍵搞定！

💡 GitHub Copilot：微軟 AI 程式夥伴，開發者必備神器
👉 智能建議、程式碼解釋、測試生成，團隊協作更順暢！`;
}

function getFallbackTags(): string[] {
  return [
    'AI', 'AI懶���報', 'AI懶人報 Podcast', 'podcast', 'AI工具',
    '人工智慧', 'AI新聞', 'ChatGPT', 'Claude', 'OpenAI',
    'Gemini', 'AI教學', 'AI應用', '科技新聞',
  ];
}
