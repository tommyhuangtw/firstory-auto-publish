/**
 * Stage 5: Quality Scoring + Refinement Loop.
 *
 * Scoring: GPT-5.4 with 5-dimension scoring (n8n 2.腳本品質評分Agent)
 * Rewriting: Gemini 3.1 Pro (n8n 4.腳本重寫Agent)
 * Loop: score > 88 OR refineCount >= 2 → pass
 */

import { getLLMService } from '@/services/llmService';
import { createChildLogger } from '@/lib/logger';
import type { PipelineState, QualityScore } from '../state';

const log = createChildLogger('pipeline:quality');

const SCORING_MODEL = 'openai/gpt-5.4';
const REWRITE_MODEL = 'google/gemini-3.1-pro-preview';
const QUALITY_THRESHOLD = 88;
const MAX_ITERATIONS = 2;

// 機器人觀察週報 fixed opening for scoring/rewrite
const ROBOT_FIXED_OPENING = `「AI 的浪潮正在改寫機器人的發展速度，越來越多過去像科幻的能力，開始變成工程上的日常。如果照這股動能延伸下去，五年、十年後的世界一定會很精彩。這裡是 AI 懶人報：機器人觀察週報，帶你看看這週未來感最強的那些技術亮點。」`;

// AI懶人精選週報 fixed opening for scoring/rewrite
const WEEKLY_FIXED_OPENING = `「每天都有一堆新的 AI 工具冒出來，是不是常常不知道該從哪裡開始。別擔心，今天的《AI懶人精選週報》，就是要幫你整理過去一週，最受關注、最有用、最不能錯過的 AI 工具新趨勢，不怕跟不上AI浪潮，這集讓你一次補齊！」`;

// n8n exact system prompt for 2.腳本品質評分Agent
const SCORING_SYSTEM_PROMPT = `你是一位極度嚴苛、追求完美的 Podcast 製作人與語感專家。你的任務是擔任《AI懶人報》的總編輯，對腳本進行嚴格審查。你對「書面感」、「大陸用語」以及「生硬轉場」零容忍。如果講稿聽起來像 AI 生成的、像在讀論文，你必須給予低分並精確指出病灶給予專業建議。

核心強制規範（違者重扣）：
開場格式： 必須與指定格式相同概念，但可以自然些微調整。
結尾導流： 必須包含導流提醒與評分邀請，且語氣必須自然融入，不可生硬切換。
拒絕幻覺： 評論必須基於文本事實，不可給予籠統的「還可以」、「再加油」等廢話。

每個項目都要給我400-600字的嚴厲批判與實際改善建議

你是一位專業的 Podcast 腳本審稿專家，請你根據以下 Podcast 腳本，依據四個語言品質面向進行評分與詳細分析。每個面向有不同權重（總分為 100 分）。請從語氣自然性、中英夾雜、中國用語、以及敘述的具體性進行分析。

開場必須為固定格式：
"每天都有一堆新的AI工具冒出來，是不是常常不知道該從哪裡開始？別擔心，這裡是AI懶人報，每天幫你精選五個最多人討論的AI工具影片，每天十分鐘，讓AI走進你的日常生活，讓你不知不覺成為效率大師。"
（注意！！ 開場後僅能接續約 3-5 句過渡語，快速帶出主題並切入重點，不可超過一段太長的鋪陳！）

結尾處必須有導流句與評分邀請：
結尾總結及導流句 控制在500字以內。

請務必提供三個結果欄位：
1. score：整體評分（總分 100 分，為四項加總）
2. comments：詳細逐項建議說明

🎧 評分項目與權重：

1. 聊天感與語氣自然度（25 分）
2. 中英夾雜控制（20 分）
3. 台灣用語友善度（20 分）
4. 說明具體性與易懂度（20 分）
5. 字數控制（15 分）`;

// n8n exact system prompt for 4.腳本重寫Agent
const REWRITE_SYSTEM_PROMPT = `你是一位專業的 Podcast 腳本優化專家，擅長將技術性或資訊性內容，轉換成輕鬆、有故事感、適合口語朗讀的 Podcast 腳本，整體篇幅要落於4000-5000 字左右的長度。

🎯 任務說明：
請根據評分 Agent 所提供的審稿建議，針對原始 Podcast 腳本進行大幅優化。你的目標是將內容轉換成 自然、親切、容易理解 的敘述，適合用來口語錄製，目標是產出一段適合直接餵給語音合成模型（Text-to-Speech）朗讀的稿件，語句需自然、親切、無干擾物，讓聽眾在「像聽朋友講話」的節奏中獲得實用資訊。

📝 優化目標與判準
✅ 聊天感與自然語氣
✅ 具體化說明，加入生活化範例或小故事

❌ 避免中英夾雜（除必要專有名詞）
❌ 排除中國用語，改為台灣常見說法
❌ 禁止出現以下內容：
任何括號內的說明或指令（例如：(轉場音樂)、(結尾音樂逐漸響起)、（嘿，別評斷喔！） 等）
語音系統無法辨識或唸出來會造成干擾的內部註解

✅ 開場段落規範：開場請勿過長！
開場必須為固定格式：
"每天都有一堆新的AI工具冒出來，是不是常常不知道該從哪裡開始？別擔心，這裡是AI懶人報，每天幫你精選五個最多人討論的AI工具影片，每天十分鐘，讓AI走進你的日常生活，讓你不知不覺成為效率大師。"
（注意！！ 開場後僅能接續約 2~3 句過渡語，快速帶出主���並切入重點，不可超過一段太長的鋪陳！）

結尾段落需流暢的包涵導流句，評分邀請，明天再繼續收聽的提醒句～
接近結尾處必須有��流句與評分邀請：
輪流使用以下版本
ver1: 如果今天的內容對你有幫助，想收到更多最新最即時的AI工具心得分享跟資源，也歡迎追蹤我的 IG、Threads 和 Facebook，搜尋「AI懶人報」就找得到。順手幫我在 Apple Podcast 或你常用的平台留個五星好評，可以幫助我讓更多人一起接收到這些實用的 AI 工具資訊，一起變聰明、不加班！
ver2: 如果你覺得今天的內容讓你有點收穫，那就幫我到 Apple Podcast 按讚追蹤、留個五星好評吧！FB、IG、Threads 搜「AI懶人報」，就找得到我了！你的支持，是我持續優化內容的最大動力！

結尾句選項（五選一，請隨機挑用）：
🎙 ver1：今天的AI懶人報就報到這，我是湯懶懶，我們明天見，掰啦！
🎙 ver2：好啦，希望你今天也有學到一點AI乾貨，玩完再來跟我分享你們的心得喔，我們明天見！
🎙 ver3：不想錯過最新的AI工具，明天再繼續回來AI懶人報，我是湯懶懶，明天見，掰掰！
🎙 ver4：今天分享的AI工具我都覺得蠻實用的，你們覺得呢？我是湯懶懶，我們明天據續朝懶人工作邁進！ 掰掰！
🎙 ver5：最近的AI發展依然快得讓我害怕，不想錯過明天再繼續收聽AI懶人報囉，我是湯懶懶，我們明天見，掰掰！

🛠 執行原則總結：
- 不是逐句翻修，而是整段重寫
- 遇到抽象概念→改用比喻／場景故事說明
- 資訊過多→簡化＋舉例帶出重點
- 詞語卡口或過書面→改用常見口語轉譯

📥 請依照以下 JSON 格式輸出結果：

{
  "original_script": "（這裡是優化後完整的 Podcast 腳本）"
}`;

function getScoringPrompt(segmentType: string): string {
  if (segmentType === 'daily') return SCORING_SYSTEM_PROMPT;

  const fixedOpening = segmentType === 'robot' ? ROBOT_FIXED_OPENING : WEEKLY_FIXED_OPENING;
  return SCORING_SYSTEM_PROMPT
    .replace(
      `開場必須為固定格式：
"每天都有一堆新的AI工具冒出來，是不是常常不知道該從哪裡開始？別擔心，這裡是AI懶人報，每天幫你精選五個最多人討論的AI工具影片，每天十分鐘，讓AI走進你的日常生活，讓你不知不覺成為效率大師。"
（注意！！ 開場後僅能接續約 3-5 句過渡語，快速帶出主題並切入重點，不可超過一段太長的鋪陳！）`,
      `開場必須為固定格式：
${fixedOpening}
（句子的細部語序可自然些微調整，但整體概念要一致。開場後僅能接續約 3-5 句過渡語，快速帶出主題並切入重點！）`
    );
}

function getRewritePrompt(segmentType: string): string {
  if (segmentType === 'daily') return REWRITE_SYSTEM_PROMPT;

  const fixedOpening = segmentType === 'robot' ? ROBOT_FIXED_OPENING : WEEKLY_FIXED_OPENING;
  const wordCount = segmentType === 'robot' ? '5000-6000' : '4500-5500';
  return REWRITE_SYSTEM_PROMPT
    .replace(
      '整體篇幅要落於4000-5000 字左右的長度',
      `整體篇幅要落於${wordCount} 字左右的長度`
    )
    .replace(
      `開場必須為固定格式：
"每天都有一堆新的AI工具冒出來，是不是常常不知道該從哪裡開始？別擔心，這裡是AI懶人報，每天幫你精選五個最多人討論的AI工具影片，每天十分鐘，讓AI走進你的日常生活，讓你不知不覺成為效率大師。"
（注意！！ 開場後僅能接續約 2~3 句過渡語，快速帶出主題並切入重點，不可超過一段太長的鋪陳！）`,
      `開場必須為固定格式：
${fixedOpening}
（句子的細部語序可自然些微調整，但整體概念要一致。開場後僅能接續約 2~3 句過渡語，快速帶出主題並切入重點！）`
    );
}

export async function qualityScore(state: PipelineState): Promise<Partial<PipelineState>> {
  log.info({ iteration: state.qualityIterations }, 'Scoring script quality');

  if (!state.scriptZh) {
    return { qualityScore: null, status: 'generating_meta' };
  }

  const llm = getLLMService();
  const segmentType = state.segmentType;
  const isRobot = segmentType === 'robot';
  const isWeekly = segmentType === 'weekly';
  let currentScript = state.scriptZh;
  let score: QualityScore | null = null;
  let iterations = state.qualityIterations;

  // Memory-aware quality check context
  const memoryQualityBrief = state.memoryContext?.briefForQualityCheck || '';

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // ── Score the script (GPT-5.4) ──
    const scoringUserPrompt = `【待評分腳本】
${currentScript}
${memoryQualityBrief ? `\n【觀眾記憶背景】\n${memoryQualityBrief}\n` : ''}
請根據以上內容給予評分與建議。

📥 請依照以下 JSON 格式輸出��果：

{
  "score": {
    "chat_feel": 0,
    "eng_mix": 0,
    "tw_localization": 0,
    "clarity": 0,
    "word_count": 0,
    "total": 0
  },
  "comments": {
    "chat_feel": "請針對語氣自然度給予具體建議",
    "eng_mix": "請指出中英夾雜的句子與建議改寫方式",
    "tw_localization": "列出使用的中國用語與台灣常見對應詞",
    "clarity": "指出缺乏舉例的段落與建議可加入的故事或角色場景",
    "word_count": "腳本目前字數確認",
    "summary": "總結性建議"
  }
}`;

    const scoreResponse = await llm.call({
      stage: 'scoring',
      episodeNumber: state.episodeNumber,
      messages: [
        { role: 'system', content: getScoringPrompt(segmentType) },
        { role: 'user', content: scoringUserPrompt },
      ],
      options: {
        preferredModel: SCORING_MODEL,
        maxTokens: 4096,
        temperature: 0.3,
      },
    });

    if (!scoreResponse.success || !scoreResponse.content) {
      log.warn('Scoring failed, proceeding without score');
      break;
    }

    const data = parseScoringResponse(scoreResponse.content);
    if (!data) {
      log.warn('Scoring JSON parse failed, proceeding without score');
      break;
    }
    score = {
      overall: data.score?.total ?? 0,
      dimensions: {
        chat_feel: data.score?.chat_feel ?? 0,
        eng_mix: data.score?.eng_mix ?? 0,
        tw_localization: data.score?.tw_localization ?? 0,
        clarity: data.score?.clarity ?? 0,
        word_count: data.score?.word_count ?? 0,
      },
      comments: {
        chat_feel: data.comments?.chat_feel ?? '',
        eng_mix: data.comments?.eng_mix ?? '',
        tw_localization: data.comments?.tw_localization ?? '',
        clarity: data.comments?.clarity ?? '',
        word_count: data.comments?.word_count ?? '',
        summary: data.comments?.summary ?? '',
      },
    };
    iterations++;

    log.info(
      { total: score.overall, iteration: iterations, dimensions: score.dimensions },
      'Quality score'
    );

    // Check pass condition: score > 88 OR iterations >= 2
    if (score.overall > QUALITY_THRESHOLD || iterations >= MAX_ITERATIONS) {
      if (score.overall > QUALITY_THRESHOLD) {
        log.info('Quality threshold met');
      } else {
        log.info({ iterations }, 'Max iterations reached');
      }
      break;
    }

    // ── Rewrite the script (Gemini 3.1 Pro) ──
    log.info({ score: score.overall, threshold: QUALITY_THRESHOLD }, 'Refining script');

    const rewriteUserPrompt = `【目前腳本版本】
${currentScript}

【評分建議】
請根據以下評論修改：
增加聊天感：${score.comments.chat_feel}

改善中英夾雜：${score.comments.eng_mix}

使用台灣用詞：${score.comments.tw_localization}

表達清晰及小故事使用：${score.comments.clarity}

字數限制： ${score.comments.word_count}

整體建議： ${score.comments.summary}

請根據建議重寫腳本，產出 ${isRobot ? '5000-6000' : isWeekly ? '4500-5500' : '4000-4500'} 字的完整繁體中文腳本。`;

    const rewriteResult = await llm.call({
      stage: 'script_refine',
      episodeNumber: state.episodeNumber,
      messages: [
        { role: 'system', content: getRewritePrompt(segmentType) },
        { role: 'user', content: rewriteUserPrompt },
      ],
      options: {
        preferredModel: REWRITE_MODEL,
        maxTokens: 8192,
        temperature: 0.7,
      },
    });

    if (rewriteResult.success && rewriteResult.content) {
      currentScript = extractScriptFromResponse(rewriteResult.content);
      log.info({ newLength: currentScript.length }, 'Script refined');
    } else {
      log.warn('Rewrite failed, keeping current script');
      break;
    }
  }

  return {
    scriptZh: currentScript,
    qualityScore: score,
    qualityIterations: iterations,
    status: 'generating_meta',
  };
}

/**
 * Parse scoring JSON from LLM response with defensive fallbacks.
 */
function parseScoringResponse(content: string): {
  score: { chat_feel: number; eng_mix: number; tw_localization: number; clarity: number; word_count: number; total: number };
  comments: { chat_feel: string; eng_mix: string; tw_localization: string; clarity: string; word_count: string; summary: string };
} | null {
  try {
    const trimmed = content.trim();
    // Try direct parse
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Try markdown code block extraction
      const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        // Try first JSON object
        const objectMatch = trimmed.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          parsed = JSON.parse(objectMatch[0]);
        } else {
          throw new Error('No JSON found');
        }
      }
    }

    const s = (parsed.score || {}) as Record<string, number>;
    const c = (parsed.comments || {}) as Record<string, string>;
    return {
      score: {
        chat_feel: s.chat_feel ?? 0,
        eng_mix: s.eng_mix ?? 0,
        tw_localization: s.tw_localization ?? 0,
        clarity: s.clarity ?? 0,
        word_count: s.word_count ?? 0,
        total: s.total ?? 0,
      },
      comments: {
        chat_feel: c.chat_feel ?? '',
        eng_mix: c.eng_mix ?? '',
        tw_localization: c.tw_localization ?? '',
        clarity: c.clarity ?? '',
        word_count: c.word_count ?? '',
        summary: c.summary ?? '',
      },
    };
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Scoring JSON parse failed');
    return null;
  }
}

/**
 * Extract clean script text from LLM response.
 * The model may return JSON like { "original_script": "..." } or
 * markdown-wrapped JSON. This extracts the actual script content.
 */
function extractScriptFromResponse(content: string): string {
  const trimmed = content.trim();

  // Try to parse as JSON (with or without markdown code block)
  try {
    // Strip markdown code block if present
    const jsonStr = trimmed.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(jsonStr);
    if (parsed.original_script && typeof parsed.original_script === 'string') {
      return parsed.original_script.trim();
    }
  } catch { /* not JSON, continue */ }

  // Try to find JSON object in the response
  const jsonMatch = trimmed.match(/\{\s*"original_script"\s*:\s*"([\s\S]*?)"\s*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.original_script) return parsed.original_script.trim();
    } catch { /* malformed JSON, continue */ }
  }

  // Not JSON — return as plain text, stripping any remaining artifacts
  return trimmed
    .replace(/^```(?:json)?\s*/g, '')
    .replace(/\s*```$/g, '')
    .trim();
}
