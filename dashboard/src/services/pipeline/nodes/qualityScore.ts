/**
 * Stage 5: Quality Scoring + Refinement Loop.
 *
 * Scoring: GPT-5.4 with 5-dimension scoring (n8n 2.腳本品質評分Agent)
 * Rewriting: Gemini 3.1 Pro (n8n 4.腳本重寫Agent)
 * Loop: score > 88 OR refineCount >= 2 → pass
 */

import { getLLMService } from '@/services/llmService';
import { createChildLogger } from '@/lib/logger';
import { getDb } from '@/db';
import { AI_STYLE_BLACKLIST } from '@/services/llm/aiStyleBlacklist';
import type { PipelineState, QualityScore, QualityIteration } from '../state';

const log = createChildLogger('pipeline:quality');

/** Count non-whitespace characters in a script. */
export function countScriptChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

/** Read word count target from DB settings, fallback to defaults. */
export function getWordCountTarget(segmentType: string, episodeLength?: number | null): [number, number] {
  if (segmentType === 'quickchat' && episodeLength) {
    const quickchatDefaults: Record<number, [number, number]> = {
      12: [3500, 4500],
      15: [5000, 6000],
      18: [5800, 6800],
      21: [7000, 8000],
      25: [8000, 9000],
    };
    return quickchatDefaults[episodeLength] || [5800, 6800];
  }
  const key = `word_count_${segmentType}`;
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (row?.value) {
    const match = row.value.match(/(\d+)\s*-\s*(\d+)/);
    if (match) return [parseInt(match[1]), parseInt(match[2])];
  }
  const defaults: Record<string, [number, number]> = {
    // daily: density-adaptive band — thin topics ~10-13 min (4000), rich topics ~20-22 min (8000),
    // hard ceiling ~23 min. Scoring/rewrite only push back when outside this wide band.
    daily: [4000, 8000],
    weekly: [5000, 5500],
    robot: [5000, 6000],
    sysdesign: [7500, 9000],
  };
  return defaults[segmentType] || [4500, 5000];
}

const SCORING_MODEL = 'openai/gpt-5.5';
const REWRITE_MODEL = 'anthropic/claude-sonnet-4.6';
const QUALITY_THRESHOLD = 90;
const MAX_ITERATIONS = 2;
// 分數低於此值時，即使跑滿 MAX_ITERATIONS 也再多跑一次 review + rewrite
const MIN_ACCEPTABLE_SCORE = 75;
// 分數持續低於 MIN_ACCEPTABLE_SCORE 時的硬上限（最多再多跑 1 次）
const MAX_ITERATIONS_WHEN_LOW = 3;

// 機器人觀察週報 fixed opening for scoring/rewrite
const ROBOT_FIXED_OPENING = `「AI 的浪潮正在改寫機器人的發展速度，越來越多過去像科幻的能力，開始變成工程上的日常。如果照這股動能延伸下去，五年、十年後的世界一定會很精彩。這裡是 AI 懶人報：機器人觀察週報，帶你看看這週未來感最強的那些技術亮點。」`;

// AI懶人精選週報 fixed opening for scoring/rewrite
const WEEKLY_FIXED_OPENING = `「每天都有一堆新的 AI 工具冒出來，是不是常常不知道該從哪裡開始。別擔心，今天的《AI懶人精選週報》，就是要幫你整理過去一週，最受關注、最有用、最不能錯過的 AI 工具新趨勢，不怕跟不上AI浪潮，這集讓你一次補齊！」`;

// 系統設計懶懶學 fixed opening for scoring/rewrite
const SYSDESIGN_FIXED_OPENING = `「哈嘍大家好，歡迎回到 AI 懶人報。你有沒有想過，當你每天打開 Spotify 聽歌，或是在 Uber 上叫車時，背後那個能支撐全球千萬人同時使用的『大腦』到底是長什麼樣子的？今天這個單元是，『系統設計懶懶學』。希望透過20分鐘，用輕鬆的方式，我們一起深度拆解這些頂級的大型軟體架構。畢竟在 AI 時代，懂得怎麼把這塊拼圖拼好，比會寫 code ，還要重要得多。那我們就開始吧！」`;

// 懶懶碎碎念 fixed opening for scoring/rewrite
const QUICKCHAT_FIXED_OPENING = `「哈囉，歡迎回到 AI 懶人報。今天的這個單元是懶懶碎碎念，我們會用輕鬆的方式，聊聊最近看到一些有趣的 AI 話題跟觀點。沒有排行榜、沒有工具清單，就是用輕鬆的方式分享一些想法，那我們開始吧！」`;

// n8n exact system prompt for 2.腳本品質評分Agent
const SCORING_SYSTEM_PROMPT = `你是一位經驗豐富、標準明確的 Podcast 製作人與語感專家。你的任務是擔任《AI懶人報》的總編輯，根據明確的評分標準對腳本進行公正審查。對「書面感」、「大陸用語」以及「生硬轉場」要嚴格把關。如果講稿聽起來像 AI 生成的、像在讀論文，你必須給予低分並精確指出病灶給予專業建議。

核心強制規範（違者重扣）：
開場格式： 必須與指定格式相同概念，但可以自然些微調整。
結尾導流： 必須包含導流提醒與評分邀請，且語氣必須自然融入，不可生硬切換。
拒絕幻覺： 評論必須基於文本事實，不可給予籠統的「還可以」、「再加油」等廢話。

每個項目都要給我 300-500 字的具體評分依據：引用腳本中不好的實際句子、指出具體可優化的點、並給出可執行的改寫範例或改善建議。

你是一位專業的 Podcast 腳本審稿專家，請你根據以下 Podcast 腳本，依據四個語言品質面向進行評分與詳細分析。每個面向有不同權重（總分為 100 分）。請從語氣自然性、中英夾雜、中國用語、以及敘述的具體性進行分析。

開場必須為固定格式：
"每天都有一堆新的AI工具冒出來，是不是常常不知道該從哪裡開始？別擔心，這裡是AI懶人報，每天幫你精選五個最多人討論的AI工具影片，每天十分鐘，讓AI走進你的生活中，讓你不知不覺成為效率大師。"
（注：「每天十分鐘」為品牌口號，非實際時長限制。請勿因腳本超過 10 分鐘而扣分。）
（開場後用一兩句快速 tease 今天最精彩的亮點，用懸念或好奇心勾住聽眾即可。不要列清單、不要報幕。然後直接切入主體內容。）

結尾處必須有導流句與評分邀請：
結尾總結及導流句 控制在500字以內。

請務必提供三個結果欄位：
1. score：整體評分（總分 100 分，為四項加總）
2. comments：詳細逐項建議說明

🎧 評分項目與權重：

1. 聊天感與語氣自然度（25 分）
   評估腳本是否聽起來像真人在聊天，而非 AI 生成或書面報告。
   — 20-25 分：全篇聽起來像朋友聊天，語氣自然不做作，有個人風格
   — 14-19 分：大部分自然，但有幾段明顯書面感或 AI 生成感
   — 8-13 分：整體偏書面或公式化，轉場生硬，語氣不一致
   — 0-7 分：像在讀論文或唸稿，完全沒有聊天感
   ✅ 加分指標：語句流暢、節奏自然，有轉折詞或口語連接詞；偶爾加入聽眾互動語氣；句型有高低起伏、情緒表現適當；少量使用自然口語節奏的語助詞（「啦」「吧」「嘛」等）；描述常見場景引發共鳴（如「書籤存了一堆根本沒回去看」）；敘述者有鮮明個性，對不同內容有不同反應（不是每個工具都「很厲害」）；有真實觀點和態度；最多 1 個自然的聽眾共鳴時刻（描述到聽眾日常煩惱、引發「對我也是」的感覺），像聊天一樣融入講稿，沒有適合的就不放
   ❌ 扣分指標：長句過多或語法複雜，如報告式、論文式敘述；重複使用單一口氣（如全篇都是「這個工具可以...」「這個工具也可以...」）；沒有情緒語助詞，全篇聽感平淡；語助詞使用位置不合理（如用在資訊量重、理性說明的段落）；句尾語助詞機械性過度使用（「啦」「喔」「啊」「嘛」），導致語感拖沓、尷尬、不真實；全篇像中性資訊播報，對每個主題的態度都一樣；沒有任何個人反應或觀點；整篇零共鳴感，聽眾找不到自己的影子
   ❌ AI 文體重扣：出現以下任一項都應在此維度扣 3-5 分：使用「不是…而是」「不只…還是」「不只是…而是」「不需要…只需要」等對比句式、「接住」「對齊」的比喻用法、「有點灰」「這筆帳」「書籤起來」（應為「收藏起來」）、「讓人癱瘓」（應為「讓人瘋掉」）、「把…抽乾」（應為「耗盡」「消磨」）、「更大的背景」（應為「把背景交代清楚」）、「無痛升級」「被打到」「很貼」「降維打擊」「定心丸」、不自然的比喻（如「當成搖搖球在用」）；過度縮減詞語（如「跳步驟」→「跳過步驟」、「很穩」→「很穩定」、「撐得住」→「支撐得住」）；過度使用「老實說」（整篇最多一次，可用「說真的」替代）——這些都是 AI 生成文體的典型特徵，會讓聽眾覺得不自然

2. 中英夾雜控制（20 分）
   評估是否僅保留必要的英文專有名詞，其餘使用自然中文。
   — 16-20 分：只有必要的專有名詞用英文，其餘全部自然中文
   — 11-15 分：有少數非必要英文詞，但不影響聽感
   — 6-10 分：頻繁出現不必要的英文詞或整句英文
   — 0-5 分：中英夾雜嚴重，影響聽眾理解
   ✅ 加分指標：僅保留必要專有名詞（如 ChatGPT、workflow automation、Gemini Pro）；使用自然中文替代通用詞（如「流程順」「寫得很順」勝過「很 smooth」）；台灣工程師熟悉的字眼保留英文（GitHub / Bug / MCP / Debug / Prompt）
   ❌ 扣分指標：非必要詞彙使用英文；語意不清的英文詞彙或混合式語句（如「UI 很 friendly」「這個 tool 的功能很強」）

3. 台灣用語友善度（20 分）
   評估是否使用偏向中國大陸詞彙、語感不符合台灣聽眾習慣。
   — 16-20 分：完全使用台灣用語，沒有任何大陸用語
   — 11-15 分：有 1-3 個大陸用語需要修正
   — 6-10 分：有 4-7 個大陸用語
   — 0-5 分：大量大陸用語，不像台灣人講話
   ✅ 加分指標：全文用詞自然、接地氣，貼近台灣用語生活化語詞（如「比較順」「跑起來很快」「用起來很直覺」）
   ❌ 扣分指標：中國常用語出現（如「體驗感」「上線」「智能」「高效」「訴求」「落地」「場景」等）；冷冰冰不貼生活語境的詞彙（如「賦能」「視覺化」）

4. 說明具體性與易懂度（20 分）
   評估工具/概念說明是否具體、有例子、易理解。
   — 16-20 分：每個工具/概念都有具體用途說明和生活化例子
   — 11-15 分：大部分有具體說明，少數段落過於抽象
   — 6-10 分：多數段落只有概述，缺乏具體例子
   — 0-5 分：全篇流於空泛描述
   ✅ 加分指標：每個工具皆有明確說明用途（不是只有說「很好用」）；使用生活例子、角色視角（如「你在加班趕簡報時，這工具可以幫你一鍵整理素材」）；語意具體，說明清楚、易於理解
   ❌ 扣分指標：只列功能、不說明用途（如「可以自動生成圖片」但不說適合誰用）；沒有任何舉例、故事、使用場景；敘述抽象或行話過多

5. 字數控制（15 分）— 目標字數為 __WORD_COUNT_TARGET__ 字。
   — 13-15 分：落在目標範圍內
   — 9-12 分：偏差 500 字以內
   — 5-8 分：偏差 500-1000 字
   — 0-4 分：偏差超過 1000 字

## 評分校準範例（請嚴格以此為參考基準，避免分數膨脹）

以下是三段不同品質的腳本片段與對應分數。請在評分時對照這些範例，確保你的分數反映真實品質差異，而不是一律給高分。

### 🔴 總分約 65-70 分的腳本片段（明顯問題，需大幅修改）
「接下來，我們來看看第三個工具。這個工具主要是用於自動化流程管理，它可以幫助用戶提升工作效率，實現智能化的任務分配。通過使用這個工具，您可以更加高效地管理團隊協作，並且在多個場景下進行落地應用。接下來我們看第四個工具。」
→ 問題：書面報告感極重（「用戶」「實現」「通過」「場景」「落地」全是大陸用語）、沒有任何具體例子、轉場公式化（「接下來我們看」）、零聊天感。這種品質的腳本絕對不應超過 70 分。

### 🟡 總分約 80-84 分的腳本片段（基本合格，但有明顯可改進空間）
「好，接下來這個工具也蠻有趣的。它叫做 Replit Agent，簡單來說就是你跟它講一句話，它就能幫你把整個網站架好。聽起來很厲害吧？不過老實說，目前這個工具比較適合做一些簡單的 side project，如果你要拿來做大型的商業應用，可能還是需要再搭配其他工具。」
→ 優點：語氣自然、有口語連接詞（「老實說」「聽起來很厲害吧」）、有具體限制說明。缺點：轉場仍偏公式化（「好，接下來這個工具」）、缺少生活化使用場景、「side project」可用中文替代。這種品質應落在 80-84 分區間，不應給到 88+。

### 🟢 總分約 90-95 分的腳本片段（接近完美，僅有極微小瑕疵）
「你有沒有這種經驗？每次週末想找一部電影來看，打開 Netflix 結果滑了二十分鐘，最後還是選了看過三遍的老片。Perplexity 這個工具就是來解決這種選擇困難的。你直接跟它說『推薦我一部像乍夢的懸疑片，但不要太燒腦的』，它就會幫你從爛番茄、IMDb 各大平台比對評分，直接給你三個推薦，還附上每部片大概在演什麼。省掉你半小時的選片時間，直接躺平開看。」
→ 優點：以生活場景開場引發共鳴、語氣完全像朋友聊天、有具體使用示範、全中文無不必要英文、台灣用語道地（「躺平開看」「滑了二十分鐘」「選擇困難」）。只有達到這種水準的腳本才配得上 90+ 的分數。

⚠️ 額外審查重點（計入「聊天感與語氣自然度」維度）：請對照下方「太 AI 不能用」黑名單，逐項檢查腳本是否踩到任何一條——禁用句式（尤其「不是…而是」「不是…，是…」）、過度縮減詞語、過度簡化導致句子突兀、明顯的翻譯腔、非台灣用語。只要出現就在 chat_feel 維度扣分，並在 comments 中引用原句、給出自然的台灣口語改寫範例。
${AI_STYLE_BLACKLIST}`;

// n8n exact system prompt for 4.腳本重寫Agent
const REWRITE_SYSTEM_PROMPT = `你是一位專業的 Podcast 腳本優化專家，擅長將技術性或資訊性內容，轉換成輕鬆、有故事感、適合口語朗讀的 Podcast 腳本。

⚠️ 字數硬性限制：最終腳本必須控制在 __REWRITE_WORD_COUNT__ 字之間（去除空白後計算）。超過上限或低於下限都不合格。如果改善語感會導致字數膨脹，請同時刪減冗餘段落來維持字數平衡。

🎯 任務說明：
請根據評分 Agent 所提供的審稿建議，針對原始 Podcast 腳本進行大幅優化。你的目標是將內容轉換成 自然、親切、容易理解 的敘述，適合用來口語錄製，目標是產出一段適合直接餵給語音合成模型（Text-to-Speech）朗讀的稿件，語句需自然、親切、無干擾物，讓聽眾在「像聽朋友講話」的節奏中獲得實用資訊。

📝 優化目標與判準
✅ 聊天感與自然語氣
✅ 具體化說明，加入生活化範例或小故事

❌ 避免中英夾雜（除必要專有名詞）
❌ 排除中國用語，改為台灣常見說法
❌ 避免 AI 文體：禁用「不是…而是」「不只…還是」「不只是…而是」「不需要…只需要」等對比句式、「接住」「對齊」的比喻用法、「有點灰」「這筆帳」「書籤起來」（→收藏起來）、「讓人癱瘓」（→讓人瘋掉）、「把…抽乾」（→耗盡/消磨）、「更大的背景」（→把背景交代清楚）、「無痛升級」「被打到」「很貼」「降維打擊」「定心丸」、不自然的比喻、過度縮減詞語（「跳步驟」→「跳過步驟」、「很穩」→「很穩定」、「撐得住」→「支撐得住」）、過度使用「老實說」（最多一次，用「說真的」替代）。講稿要直接餵 TTS，語句必須完整自然好唸。
❌ 禁止出現以下內容：
任何括號內的說明或指令（例如：(轉場音樂)、(結尾音樂逐漸響起)、（嘿，別評斷喔！） 等）
語音系統無法辨識或唸出來會造成干擾的內部註解

✅ 開場段落規範：開場請勿過長！
開場必須為固定格式：
"每天都有一堆新的AI工具冒出來，是不是常常不知道該從哪裡開始？別擔心，這裡是AI懶人報，每天幫你精選五個最多人討論的AI工具影片，每天十分鐘，讓AI走進你的生活中，讓你不知不覺成為效率大師。"
（開場後用一兩句快速 tease 今天最精彩的亮點，用懸念或好奇心勾住聽眾即可。不要列清單、不要報幕。然後直接切入主體內容。）

結尾段落需流暢的包涵導流句，評分邀請，明天再繼續收聽的提醒句～
接近結尾處必須有導流句與評分邀請：
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
- 針對評分指出的具體問題進行修正，保留原稿中表現好的部分
- 遇到抽象概念→改用比喻／場景故事說明
- 資訊過多→精簡內容＋舉例帶出重點（注意：要砍的是重複和廢話「內容」，不是把句子壓短）
- 詞語卡口或過書面→改用常見口語轉譯
${AI_STYLE_BLACKLIST}

📥 請依照以下 JSON 格式輸出結果：

{
  "original_script": "（這裡是優化後完整的 Podcast 腳本）"
}`;

export function getScoringPrompt(segmentType: string, episodeLength?: number | null): string {
  const [targetMin, targetMax] = getWordCountTarget(segmentType, episodeLength);
  const targetStr = `${targetMin}-${targetMax}`;

  if (segmentType === 'daily') {
    return SCORING_SYSTEM_PROMPT
      .replace(
        `5. 字數控制（15 分）— 目標字數為 __WORD_COUNT_TARGET__ 字。
   — 13-15 分：落在目標範圍內
   — 9-12 分：偏差 500 字以內
   — 5-8 分：偏差 500-1000 字
   — 0-4 分：偏差超過 1000 字`,
        `5. 篇幅與資訊密度（15 分）— 篇幅應該配合資訊密度，不是硬湊固定字數。合理範圍 ${targetStr} 字（約 11-22 分鐘）：資訊量大的主題可以長一點、講深一點；資訊量少時就精簡，不要注水。
   — 13-15 分：篇幅與內容份量相稱，沒有廢話、重複或注水，每段都有實質資訊或具體例子
   — 9-12 分：大致合理，但有少數冗段或重複
   — 5-8 分：明顯注水、廢話多，或反過來過度壓縮導致細節不足
   — 0-4 分：嚴重超出 ${targetMax} 字（超過約 23 分鐘），或大量重複灌水`)
      .replace('__WORD_COUNT_TARGET__', targetStr);
  }

  const fixedOpening = segmentType === 'quickchat' ? QUICKCHAT_FIXED_OPENING
    : segmentType === 'sysdesign' ? SYSDESIGN_FIXED_OPENING
    : segmentType === 'robot' ? ROBOT_FIXED_OPENING
    : WEEKLY_FIXED_OPENING;
  let prompt = SCORING_SYSTEM_PROMPT
    .replace('__WORD_COUNT_TARGET__', targetStr)
    .replace(
      `開場必須為固定格式：
"每天都有一堆新的AI工具冒出來，是不是常常不知道該從哪裡開始？別擔心，這裡是AI懶人報，每天幫你精選五個最多人討論的AI工具影片，每天十分鐘，讓AI走進你的生活中，讓你不知不覺成為效率大師。"
（注：「每天十分鐘」為品牌口號，非實際時長限制。請勿因腳本超過 10 分鐘而扣分。）
（開場後用一兩句快速 tease 今天最精彩的亮點，用懸念或好奇心勾住聽眾即可。不要列清單、不要報幕。然後直接切入主體內容。）`,
      `開場必須為固定格式：
${fixedOpening}
（句子的細部語序可自然些微調整，但整體概念要一致。開場後用一兩句快速 tease 今天最精彩的亮點，用懸念或好奇心勾住聽眾即可。不要列清單、不要報幕。然後直接切入主體內容。）`
    );

  // sysdesign: replace closing expectations + scoring dimensions
  if (segmentType === 'sysdesign') {
    prompt = prompt.replace(
      `結尾導流： 必須包含導流提醒與評分邀請，且語氣必須自然融入，不可生硬切換。`,
      `結尾導流： 必須包含導流提醒與評分邀請，且語氣必須自然融入。結尾句必須使用「系統設計懶懶學」專屬版本（含「下次見」而非「明天見」），不可使用每日報的結尾。`
    );
    // Replace the full scoring dimensions block for sysdesign
    // The source prompt now has detailed rubrics, so we match the first dimension header line
    const sysdesignDimensions = `🎧 評分項目與權重：

1. 聊天感與語氣自然度（20 分）
   評估腳本是否聽起來像真人在聊天，而非 AI 生成或書面報告。
   — 16-20 分：全篇聽起來像朋友聊天，語氣自然不做作，有個人風格
   — 11-15 分：大部分自然，但有幾段明顯書面感或 AI 生成感
   — 6-10 分：整體偏書面或公式化，轉場生硬，語氣不一致
   — 0-5 分：像在讀論文或唸稿，完全沒有聊天感
   ✅ 加分指標：語句流暢、節奏自然，有轉折詞或口語連接詞；偶爾加入聽眾互動語氣；句型有高低起伏、情緒表現適當；少量使用自然口語節奏的語助詞（「啦」「吧」「嘛」等）；描述常見場景引發共鳴（如「書籤存了一堆根本沒回去看」）；敘述者有鮮明個性，對不同架構設計有不同反應；有真實觀點和態度；收尾方式多樣化（回扣式、重新定義式、比喻式等），不會每段都用「這段的重點是...」
   ❌ 扣分指標：長句過多或語法複雜，如報告式、論文式敘述；重複使用單一口氣（如全篇都是「這個工具可以...」「這個工具也可以...」）；沒有情緒語助詞，全篇聽感平淡；語助詞使用位置不合理或機械性過度使用；全篇像中性資訊播報，對每個主題的態度都一樣；沒有任何個人反應或觀點；每段都用公式化收尾（如「這段的重點是...」「核心概念是...」）
   ❌ AI 文體重扣：出現以下任一項都應在此維度扣 3-5 分：使用「不是…而是」「不只…還是」「不只是…而是」「不需要…只需要」等對比句式、「接住」「對齊」的比喻用法、「有點灰」「這筆帳」「書籤起來」（應為「收藏起來」）、「讓人癱瘓」（應為「讓人瘋掉」）、「把…抽乾」（應為「耗盡」「消磨」）、「更大的背景」（應為「把背景交代清楚」）、「無痛升級」「被打到」「很貼」「降維打擊」「定心丸」、不自然的比喻（如「當成搖搖球在用」）；過度縮減詞語（如「跳步驟」→「跳過步驟」、「很穩」→「很穩定」、「撐得住」→「支撐得住」）；過度使用「老實說」（整篇最多一次，可用「說真的」替代）

2. 中英夾雜控制（15 分）
   評估是否僅保留必要的英文專有名詞，其餘使用自然中文。注意：聽眾包含非工程師的科技愛好者，英文術語的門檻要比純工程師社群更嚴格。
   — 13-15 分：只有必要的專有名詞用英文，其餘全部自然中文
   — 9-12 分：有少數非必要英文詞，但不影響聽感
   — 4-8 分：頻繁出現不必要的英文詞或整句英文
   — 0-3 分：中英夾雜嚴重，影響聽眾理解
   ✅ 加分指標：僅保留必要專有名詞（如 App, API, server, bug, CPU）；其他技術術語都有附中文解釋
   ❌ 扣分指標：非必要詞彙使用英文；混合式語句（如「UI 很 friendly」「這個 tool 的功能很強」）；大量未解釋的英文術語讓非工程師聽眾跟不上

3. 台灣用語友善度（10 分）
   評估是否使用偏向中國大陸詞彙、語感不符合台灣聽眾習慣。
   — 8-10 分：完全使用台灣用語，沒有任何大陸用語
   — 5-7 分：有 1-3 個大陸用語需要修正
   — 2-4 分：有 4-7 個大陸用語
   — 0-1 分：大量大陸用語，不像台灣人講話
   ✅ 加分指標：全文用詞自然、接地氣，貼近台灣用語生活化語詞（如「比較順」「跑起來很快」「用起來很直覺」）；「伺服器」而非「服務器」；「資料庫」而非「數據庫」；比喻使用台灣情境（好市多、捷運、蝦皮、Line 群組）
   ❌ 扣分指標：中國常用語出現（如「體驗感」「上線」「智能」「高效」「訴求」「落地」「場景」「賦能」「視覺化」「服務器」「數據庫」等）

4. 技術深度與具體性（15 分）— 系統設計懶懶學核心評分項目
   評估每個設計決策是否有足夠深度讓 junior engineer 真正學到東西，能在面試中應用。
   — 13-15 分：
     ✓ 每個設計決策都有完整的「naive approach → 為什麼壞掉 → 真正解法 → trade-off」結構
     ✓ 包含具體數字（QPS、latency、storage）和 back-of-envelope calculation（至少 2 個）
     ✓ 清楚說明 trade-offs（犧牲什麼換什麼，為什麼可以接受）
     ✓ 技術細節足夠深入，聽完能在面試中說出具體的方案和數字
   — 9-12 分：
     有深入說明，但 1-2 個主題只是表面帶過
     有數字但缺少計算推導過程
     有提 trade-offs 但沒深入解釋為什麼選這個方向
   — 5-8 分：
     多數只講「是什麼」，沒講「為什麼」和「trade-off」
     缺少具體數字和計算
     沒有 naive approach → real solution 的對比故事
   — 0-4 分：
     只有表面技術描述，像是維基百科的摘要
     沒有數字、trade-offs、失敗案例
     聽完無法在面試中應用任何具體知識
   ✅ 加分指標：每個深潛完整5部分（問題→直覺解→壞掉→真解→收尾）、2+計算推導、trade-off 討論附理由、真實失敗案例、pattern recognition（跨系統的 pattern 連結）
   ❌ 扣分指標：只講「是什麼」不講「為什麼」、沒有具體數字、沒有 naive vs real 對比、trade-off 只是一句話帶過、所有主題深度一樣淺

5. 字數控制（10 分）— 目標字數為 ${targetStr} 字。
   — 9-10 分：落在目標範圍內
   — 6-8 分：偏差 500 字以內
   — 3-5 分：偏差 500-1000 字
   — 0-2 分：偏差超過 1000 字
   注意：如果字數超過上限但技術深度保持完整，不應過度扣分。技術深度 > 字數控制。

6. 結構流暢度（20 分）— 此項為「系統設計懶懶學」專屬評分項目，請嚴格審查以下要點：
   a. 素材來源歸因：開場是否有用 1-2 句提到參考影片的作者或頻道背景？（不可省略）
   b. 懸念式重點預覽：進入技術深潛之前，是否用 2-4 句列出「今天要回答的問題」（而非直接列技術名詞如 sharding、replication），讓聽眾帶著好奇心進入深潛？
   c. 節奏與消化性：(i) 每個技術主題之間是否用問句驅動轉場（而非平淡的「接下來我們來看」）？(ii) 密集技術段落後是否有 recap 或 so-what 收尾句？(iii) 整體是否有「呼吸感」，不會連續 6 分鐘以上的密集技術內容沒有喘息？
   d. 深潛完整性：每個深潛主題是否都完整展開（問題→直覺解→壞掉→真解→收尾）？有沒有只是蜻蜓點水帶過的主題？
   e. 數字推算：是否有至少 2 個 back-of-envelope 數字推算（QPS、storage、latency budget 等）？

7. 聽覺友善度（10 分）— 確保內容適合「用聽的」，非工程師聽眾也能跟上
   — 9-10 分：
     ✓ 零程式碼：完全沒有 SQL、函數、schema、pseudo-code
     ✓ 術語皆有解釋：每個非日常技術詞第一次出現時都有一句白話解釋或比喻
     ✓ 呼吸感充足：每個主題之間都有喘息段落，沒有連續超過 4 分鐘密集技術轟炸
     ✓ 聽眾定位正確：面向非工程師科技愛好者 + junior engineer，不預設聽眾有分散式系統背景
   — 6-8 分：
     沒有程式碼，但有 1-2 個術語沒解釋，或某段缺少呼吸點
   — 3-5 分：
     有少量程式碼片段，多個術語未解釋，聽眾可能跟不上
   — 0-2 分：
     包含大段程式碼、大量未解釋術語、聽眾完全無法理解
   ✅ 加分指標：術語都有生活化比喻（「你可以想像成...」）、技術段落後有收尾、節奏有快有慢
   ❌ 扣分指標（任一出現都應重扣）：出現 SQL 語句、出現 schema 定義、超過 5 個專業術語沒解釋、連續超過 1500 字沒有喘息`;

    // Use regex to replace everything from 🎧 to the end of the scoring block
    const scoringBlockStart = prompt.indexOf('🎧 評分項目與權重：');
    if (scoringBlockStart !== -1) {
      prompt = prompt.slice(0, scoringBlockStart) + sysdesignDimensions;
    }
  }

  if (segmentType === 'quickchat') {
    prompt = prompt.replace(
      `結尾導流： 必須包含導流提醒與評分邀請，且語氣必須自然融入，不可生硬切換。`,
      `結尾導流： 必須包含導流提醒與評分邀請，且語氣必須自然融入。結尾句必須使用「懶懶碎碎念」專屬版本（含「下次見」而非「明天見」），不可使用每日報的結尾。`
    );
  }

  return prompt;
}

// Sysdesign-specific closing text for rewrite prompt
const SYSDESIGN_REWRITE_CLOSING = `結尾段落需流暢的包涵導流句，評分邀請，下次再繼續收聽的提醒句～
接近結尾處必須有導流句與評分邀請：
輪流使用以下版本
ver1（深度連結感）: 如果今天的系統設計拆解對你有點啟發，歡迎追蹤我的 IG、Threads 和 Facebook，搜尋「AI懶人報」就找得到。順手幫我在 Apple Podcast 給個五星好評，讓更多人接受到我的優質內容。讓我們一起看透技術本質，一起在 AI 時代不落人後，持續進步！
ver2（行動激勵感）: 覺得今天拆解 XX App 的架構讓你有點收穫嗎？那就幫我到 Apple Podcast 按讚追蹤、留個五星好評吧！如果你有想聽我拆解哪款 App，也歡迎去 FB、IG 或 Threads 搜「AI懶人報」私訊跟我說。你的支持就是我繼續把節目優化的最大動力！
（XX 請自動替換為本集討論的系統名稱。）

結尾句選項（五選一，請隨機挑用，專屬「系統設計懶懶學」）：
🎙 ver1（看透本質型）：今天的系統設計懶懶學就聊到這。希望聽完這一集，下次你再打開 XX 的時候，看到的就不只是介面，而是它背後的設計邏輯。我是湯懶懶，我們下次見，掰啦！
🎙 ver2（實踐分享型）：好啦，希望今天這套架構拆解有幫你補到一點技術乾貨。如果你對這個架構有什麼不同的想法，記得來社群跟我分享喔！我是湯懶懶，我們下次見！
🎙 ver3（思維升級型）：在這個 AI 時代，學會怎麼「設計系統」真的比「寫 code」更關鍵。別忘了訂閱 AI 懶人報，我們每集系統設計懶懶學都會帶你拆解一個大架構。我是湯懶懶，下次見，掰囉！
🎙 ver4（省時效率型）：今天聊的這些設計模式，其實都是軟體工程大神們踩坑後的精華，希望有幫大家省下自己摸索的時間！我是湯懶懶，我們同一個時間再見囉，掰掰！
🎙 ver5（持續演進型）：科技發展得很快，但底層的設計邏輯其實是有跡可循的。不想錯過更多精彩的系統拆解，記得持續鎖定 AI 懶人報。我是湯懶懶，我們下次見，掰掰！
（XX 請自動替換為本集討論的系統名稱。）`;

const QUICKCHAT_REWRITE_CLOSING = `結尾段落需流暢的包涵導流句，評分邀請，下次再繼續收聽的提醒句～
接近結尾處必須有導流句與評分邀請：
輪流使用以下版本
ver1: 如果你也對這些 AI 話題有什麼想法，歡迎追蹤我的 IG、Threads 和 Facebook，搜尋「AI懶人報」就找得到。順手幫我在 Apple Podcast 留個五星好評，讓更多人一起加入這些有趣的討論！
ver2: 如果今天聊的這些觀點讓你有點收穫，那就幫我到 Apple Podcast 按讚追蹤、留個五星好評吧！FB、IG、Threads 搜「AI懶人報」，就找得到我了！

結尾句選項（五選一，請隨機挑用，專屬「懶懶碎碎念」）：
🎙 ver1：好啦，今天的懶懶碎碎念就聊到這。我是湯懶懶，我們下次見，掰啦！
🎙 ver2：希望今天這些碎碎念有讓你想到什麼新的東西，我們下次再繼續聊！掰掰！
🎙 ver3：如果你對今天聊的這些話題有不同看法，記得來社群跟我分享。我是湯懶懶，下次見！
🎙 ver4：好，今天就先碎碎念到這。AI 的世界每天都在變，我們下次再繼續聊新的觀察。掰囉！
🎙 ver5：最近真的有太多值得聊的 AI 話題了，下次我們繼續。我是湯懶懶，掰掰！`;

const DAILY_REWRITE_CLOSING = `結尾段落需流暢的包涵導流句，評分邀請，明天再繼續收聽的提醒句～
接近結尾處必須有導流句與評分邀請：
輪流使用以下版本
ver1: 如果今天的內容對你有幫助，想收到更多最新最即時的AI工具心得分享跟資源，也歡迎追蹤我的 IG、Threads 和 Facebook，搜尋「AI懶人報」就找得到。順手幫我在 Apple Podcast 或你常用的平台留個五星好評，可以幫助我讓更多人一起接收到這些實用的 AI 工具資訊，一起變聰明、不加班！
ver2: 如果你覺得今天的內容讓你有點收穫，那就幫我到 Apple Podcast 按讚追蹤、留個五星好評吧！FB、IG、Threads 搜「AI懶人報」，就找得到我了！你的支持，是我持續優化內容的最大動力！

結尾句選項（五選一，請隨機挑用）：
🎙 ver1：今天的AI懶人報就報到這，我是湯懶懶，我們明天見，掰啦！
🎙 ver2：好啦，希望你今天也有學到一點AI乾貨，玩完再來跟我分享你們的心得喔，我們明天見！
🎙 ver3：不想錯過最新的AI工具，明天再繼續回來AI懶人報，我是湯懶懶，明天見，掰掰！
🎙 ver4：今天分享的AI工具我都覺得蠻實用的，你們覺得呢？我是湯懶懶，我們明天據續朝懶人工作邁進！ 掰掰！
🎙 ver5：最近的AI發展依然快得讓我害怕，不想錯過明天再繼續收聽AI懶人報囉，我是湯懶懶，我們明天見，掰掰！`;

export function getRewritePrompt(segmentType: string, episodeLength?: number | null): string {
  const [rwMin, rwMax] = getWordCountTarget(segmentType, episodeLength);
  const wordCountStr = `${rwMin}-${rwMax}`;

  if (segmentType === 'daily') {
    return REWRITE_SYSTEM_PROMPT.replace('__REWRITE_WORD_COUNT__', wordCountStr);
  }

  const fixedOpening = segmentType === 'quickchat' ? QUICKCHAT_FIXED_OPENING
    : segmentType === 'sysdesign' ? SYSDESIGN_FIXED_OPENING
    : segmentType === 'robot' ? ROBOT_FIXED_OPENING
    : WEEKLY_FIXED_OPENING;
  const closingText = segmentType === 'quickchat' ? QUICKCHAT_REWRITE_CLOSING
    : segmentType === 'sysdesign' ? SYSDESIGN_REWRITE_CLOSING
    : DAILY_REWRITE_CLOSING;
  let prompt = REWRITE_SYSTEM_PROMPT
    .replace('__REWRITE_WORD_COUNT__', wordCountStr)
    .replace(
      `開場必須為固定格式：
"每天都有一堆新的AI工具冒出來，是不是常常不知道該從哪裡開始？別擔心，這裡是AI懶人報，每天幫你精選五個最多人討論的AI工具影片，每天十分鐘，讓AI走進你的生活中，讓你不知不覺成為效率大師。"
（開場後用一兩句快速 tease 今天最精彩的亮點，用懸念或好奇心勾住聽眾即可。不要列清單、不要報幕。然後直接切入主體內容。）`,
      `開場必須為固定格式：
${fixedOpening}
（此開場為固定文案，請完整保留概念，不要修改。開場後用一兩句快速 tease 今天最精彩的亮點，用懸念或好奇心勾住聽眾即可。不要列清單、不要報幕。然後直接切入主體內容。）`
    )
    .replace(
      `結尾段落需流暢的包涵導流句，評分邀請，明天再繼續收聽的提醒句～
接近結尾處必須有導流句與評分邀請：
輪流使用以下版本
ver1: 如果今天的內容對你有幫助，想收到更多最新最即時的AI工具心得分享跟資源，也歡迎追蹤我的 IG、Threads 和 Facebook，搜尋「AI懶人報」就找得到。順手幫我在 Apple Podcast 或你常用的平台留個五星好評，可以幫助我讓更多人一起接收到這些實用的 AI 工具資訊，一起變聰明、不加班！
ver2: 如果你覺得今天的內容讓你有點收穫，那就幫我到 Apple Podcast 按讚追蹤、留個五星好評吧！FB、IG、Threads 搜「AI懶人報」，就找得到我了！你的支持，是我持續優化內容的最大動力！

結尾句選項（五選一，請隨機挑用）：
🎙 ver1：今天的AI懶人報就報到這，我是湯懶懶，我們明天見，掰啦！
🎙 ver2：好啦，希望你今天也有學到一點AI乾貨，玩完再來跟我分享你們的心得喔，我們明天見！
🎙 ver3：不想錯過最新的AI工具，明天再繼續回來AI懶人報，我是湯懶懶，明天見，掰掰！
🎙 ver4：今天分享的AI工具我都覺得蠻實用的，你們覺得呢？我是湯懶懶，我們明天據續朝懶人工作邁進！ 掰掰！
🎙 ver5：最近的AI發展依然快得讓我害怕，不想錯過明天再繼續收聽AI懶人報囉，我是湯懶懶，我們明天見，掰掰！`,
      closingText
    );

  // sysdesign: add structure protection rules to prevent rewrite from flattening the story arc
  if (segmentType === 'sysdesign') {
    prompt += `

🏗️ 系統設計懶懶學專屬重寫規則（務必遵守）：
- 保留問句驅動的轉場結構，不要改成平淡過渡（如「接下來我們來看」）
- 保留「naive approach → 為什麼會壞掉 → 真正的解法」的故事弧，不可壓縮成直接告訴答案
- 保留每個技術主題後的 so-what 收尾句（「所以這邊的重點是...」）
- 保留 breathing points（recap + 問句帶到下一段），這是防止聽眾 fade out 的關鍵
- 技術 trade-off 的解釋不可過度簡化——這是教育價值的核心
- 絕對不可壓縮 back-of-envelope calculation（QPS、storage 等數字推算過程必須完整保留）
- 絕對不可把完整的 5 段式深潛結構（問題→直覺解→壞掉→真解→收尾）壓成直接告訴答案
- 保留 pattern recognition 段落（跨系統的 pattern 連結）
- 如果某個 topic 的深度不夠，rewrite 時應該補充具體數字和 trade-off 說明，而不是刪除該段落
- 改善的重點放在語氣自然度和台灣用語，不是刪減技術內容
- 技術深度 > 字數控制：寧可字數稍微超標，也不可為了控字數而犧牲深度
- 如果腳本中有任何程式碼（SQL、schema、function call），必須全部轉換為口語描述
- 如果有術語沒有解釋，補上一句白話說明或比喻
- 如果有連續超過 1200 字的密集技術段落沒有喘息，插入 recap 或比喻段落`;
  }

  return prompt;
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
  const history: QualityIteration[] = [];

  // Memory-aware quality check context (sysdesign/quickchat: skip memory system)
  const memoryQualityBrief = (segmentType === 'sysdesign' || segmentType === 'quickchat')
    ? ''
    : state.memoryContext?.briefForQualityCheck || '';

  for (let i = 0; i < MAX_ITERATIONS_WHEN_LOW; i++) {
    // ── Score the script (GPT-5.4) ──
    const structureFlowScore = segmentType === 'sysdesign' ? `
    "structure_flow": 0,
    "audio_safety": 0` : '';
    const structureFlowComment = segmentType === 'sysdesign' ? `
    "structure_flow": "請檢查：(a) 素材來源歸因 (b) 懸念式重點預覽 (c) 問句驅動轉場 (d) 每個深潛主題是否完整展開5部分 (e) 是否有至少2個back-of-envelope數字推算",
    "audio_safety": "請檢查：(a) 是否有任何程式碼（SQL/schema/pseudo-code）(b) 非日常術語是否都有白話解釋 (c) 是否有連續超過1500字沒有喘息段落的區段 (d) 內容是否面向非工程師科技愛好者+junior engineer",` : '';

    const actualCharCount = countScriptChars(currentScript);
    const [tMin, tMax] = getWordCountTarget(segmentType, state.episodeLength);

    const scoringUserPrompt = `【待評分腳本】（本腳本實際字數：${actualCharCount} 字，目標：${tMin}-${tMax} 字）
${currentScript}
${memoryQualityBrief ? `\n【觀眾記憶背景】\n${memoryQualityBrief}\n` : ''}
請根據以上內容給予評分與建議。

📥 請依照以下 JSON 格式輸出結果：

{
  "score": {
    "chat_feel": 0,
    "eng_mix": 0,
    "tw_localization": 0,
    "clarity": 0,
    "word_count": 0,${structureFlowScore}
    "total": 0
  },
  "comments": {
    "chat_feel": "請引用 2-3 個具體句子說明問題所在，並給出改寫範例",
    "eng_mix": "請列出所有不必要的英文詞，並給出中文替代詞",
    "tw_localization": "請列出所有大陸用語，並給出台灣對應詞",
    "clarity": "${segmentType === 'sysdesign' ? '請檢查：(a) 每個設計決策是否有完整 naive→壞掉→解法→trade-off 結構 (b) 是否有具體數字 (c) trade-off 是否有說明犧牲什麼換什麼' : '請指出 1-2 個最缺乏具體說明的段落，並建議可加入的生活化例子或使用場景'}",
    "word_count": "腳本目前字數確認",${structureFlowComment}
    "summary": "總結性建議"
  }
}`;

    const scoreResponse = await llm.call({
      stage: 'scoring',
      episodeId: state.episodeId,
      messages: [
        { role: 'system', content: getScoringPrompt(segmentType, state.episodeLength) },
        { role: 'user', content: scoringUserPrompt },
      ],
      options: {
        preferredModel: SCORING_MODEL,
        maxTokens: 8192,
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
        ...(segmentType === 'sysdesign' && { structure_flow: data.score?.structure_flow ?? 0 }),
        ...(segmentType === 'sysdesign' && { audio_safety: data.score?.audio_safety ?? 0 }),
      },
      comments: {
        chat_feel: data.comments?.chat_feel ?? '',
        eng_mix: data.comments?.eng_mix ?? '',
        tw_localization: data.comments?.tw_localization ?? '',
        clarity: data.comments?.clarity ?? '',
        word_count: data.comments?.word_count ?? '',
        ...(segmentType === 'sysdesign' && { structure_flow: data.comments?.structure_flow ?? '' }),
        ...(segmentType === 'sysdesign' && { audio_safety: data.comments?.audio_safety ?? '' }),
        summary: data.comments?.summary ?? '',
      },
    };
    iterations++;
    history.push({ iteration: iterations, score, scriptZh: currentScript });

    log.info(
      { total: score.overall, iteration: iterations, dimensions: score.dimensions },
      'Quality score'
    );

    // Stop conditions:
    //   1. score > 90 → quality threshold met
    //   2. iterations >= MAX_ITERATIONS AND score >= 75 → good enough, normal stop
    //   3. iterations >= MAX_ITERATIONS_WHEN_LOW → hard cap (score still < 75, give up)
    // i.e. a sub-75 score earns one extra review + rewrite beyond the normal cap.
    const passed = score.overall > QUALITY_THRESHOLD;
    const goodEnough = iterations >= MAX_ITERATIONS && score.overall >= MIN_ACCEPTABLE_SCORE;
    const hitHardCap = iterations >= MAX_ITERATIONS_WHEN_LOW;
    if (passed || goodEnough || hitHardCap) {
      if (passed) {
        log.info('Quality threshold met');
      } else if (goodEnough) {
        log.info({ iterations }, 'Max iterations reached');
      } else {
        log.info({ iterations, score: score.overall }, 'Hard iteration cap reached, score still below minimum');
      }
      break;
    }

    if (iterations >= MAX_ITERATIONS && score.overall < MIN_ACCEPTABLE_SCORE) {
      log.info({ iterations, score: score.overall, min: MIN_ACCEPTABLE_SCORE }, 'Score below minimum, running extra refinement iteration');
    }

    // ── Rewrite the script (Gemini 3.1 Pro) ──
    log.info({ score: score.overall, threshold: QUALITY_THRESHOLD }, 'Refining script');

    const structureFlowFeedback = segmentType === 'sysdesign' && score.comments.structure_flow
      ? `\n結構流暢度（素材來源歸因、重點預覽、主題轉場）：${score.comments.structure_flow}\n` : '';
    const audioSafetyFeedback = segmentType === 'sysdesign' && score.comments.audio_safety
      ? `\n聽覺友善度（程式碼、術語解釋、呼吸點）：${score.comments.audio_safety}\n` : '';

    const [rwMin, rwMax] = getWordCountTarget(segmentType, state.episodeLength);
    const rwActual = countScriptChars(currentScript);
    const diffFromMin = rwMin - rwActual;
    const diffFromMax = rwActual - rwMax;
    // Near-target zone: within 200 chars of range boundary → treat as "maintain"
    const nearTarget = (rwActual >= rwMin - 200 && rwActual <= rwMax + 200);
    let wordCountGuidance: string;
    if (nearTarget && (rwActual < rwMin || rwActual > rwMax)) {
      wordCountGuidance = `目前字數 ${rwActual} 字，接近目標 ${rwMin}-${rwMax} 字，微調即可。請在改善語感的同時維持相近篇幅，不要大幅增減內容。`;
    } else if (rwActual < rwMin) {
      wordCountGuidance = `目前字數 ${rwActual} 字，低於目標下限 ${rwMin} 字（差 ${diffFromMin} 字）。請適度補充內容，但最終字數不得超過 ${rwMax} 字。`;
    } else if (rwActual > rwMax) {
      wordCountGuidance = `目前字數 ${rwActual} 字，超過目標上限 ${rwMax} 字（多 ${diffFromMax} 字）。請刪減冗餘或重複的段落，將字數壓到 ${rwMin}-${rwMax} 字之間。`;
    } else {
      wordCountGuidance = `目前字數 ${rwActual} 字，已在目標 ${rwMin}-${rwMax} 字範圍內，請維持相近篇幅，不要大幅增減。`;
    }

    const rewriteUserPrompt = `⚠️ 重要原則：請保留原稿中已經做好的部分，只針對評分建議中指出的具體問題進行修改。不要為了改而改，不要引入新的大陸用語或書面感。

【目前腳本版本】
${currentScript}

【評分建議】
請根據以下評論修改：
增加聊天感：${score.comments.chat_feel}

改善中英夾雜：${score.comments.eng_mix}

使用台灣用詞：${score.comments.tw_localization}

表達清晰及小故事使用：${score.comments.clarity}

字數控制： ${wordCountGuidance}
${structureFlowFeedback}${audioSafetyFeedback}
整體建議： ${score.comments.summary}

請根據建議重寫腳本，產出 ${rwMin}-${rwMax} 字的完整繁體中文腳本。`;

    const rewriteResult = await llm.call({
      stage: 'script_refine',
      episodeId: state.episodeId,
      messages: [
        { role: 'system', content: getRewritePrompt(segmentType, state.episodeLength) },
        { role: 'user', content: rewriteUserPrompt },
      ],
      options: {
        preferredModel: REWRITE_MODEL,
        maxTokens: (segmentType === 'sysdesign' || (segmentType === 'quickchat' && (state.episodeLength || 18) >= 21)) ? 16384 : 8192,
        temperature: 0.7,
      },
    });

    if (rewriteResult.success && rewriteResult.content) {
      const rewritten = extractScriptFromResponse(rewriteResult.content);
      const rewrittenChars = countScriptChars(rewritten);
      const originalChars = countScriptChars(currentScript);
      // Sanity check: if rewrite is less than 50% of original, it's likely truncated/broken
      if (rewrittenChars < originalChars * 0.5) {
        log.warn({ rewrittenChars, originalChars }, 'Rewrite too short, likely truncated — keeping current script');
      } else {
        currentScript = rewritten;
        log.info({ newLength: currentScript.length, chars: rewrittenChars }, 'Script refined');
      }
    } else {
      log.warn('Rewrite failed, keeping current script');
      break;
    }
  }

  return {
    scriptZh: currentScript,
    qualityScore: score,
    qualityIterations: iterations,
    qualityHistory: history,
    status: 'generating_meta',
  };
}

/**
 * Parse scoring JSON from LLM response with defensive fallbacks.
 */
/** Replace literal newlines/tabs with spaces so JSON.parse succeeds on LLM output. */
function sanitizeLLMJson(text: string): string {
  return text.replace(/[\n\r\t]/g, ' ');
}

export function parseScoringResponse(content: string): {
  score: { chat_feel: number; eng_mix: number; tw_localization: number; clarity: number; word_count: number; structure_flow?: number; audio_safety?: number; total: number };
  comments: { chat_feel: string; eng_mix: string; tw_localization: string; clarity: string; word_count: string; structure_flow?: string; audio_safety?: string; summary: string };
} | null {
  try {
    const trimmed = content.trim();
    // Try direct parse
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(sanitizeLLMJson(trimmed));
    } catch {
      // Try markdown code block extraction
      const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        parsed = JSON.parse(sanitizeLLMJson(jsonMatch[1]));
      } else {
        // Try first JSON object
        const objectMatch = trimmed.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          parsed = JSON.parse(sanitizeLLMJson(objectMatch[0]));
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
        ...(s.structure_flow != null && { structure_flow: s.structure_flow }),
        ...(s.audio_safety != null && { audio_safety: s.audio_safety }),
        total: s.total ?? 0,
      },
      comments: {
        chat_feel: c.chat_feel ?? '',
        eng_mix: c.eng_mix ?? '',
        tw_localization: c.tw_localization ?? '',
        clarity: c.clarity ?? '',
        word_count: c.word_count ?? '',
        ...(c.structure_flow != null && { structure_flow: c.structure_flow }),
        ...(c.audio_safety != null && { audio_safety: c.audio_safety }),
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
export function extractScriptFromResponse(content: string): string {
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
