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
import type { PipelineState, QualityScore, QualityIteration } from '../state';

const log = createChildLogger('pipeline:quality');

/** Count non-whitespace characters in a script. */
export function countScriptChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

/** Read word count target from DB settings, fallback to defaults. */
export function getWordCountTarget(segmentType: string): [number, number] {
  const key = `word_count_${segmentType}`;
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (row?.value) {
    const match = row.value.match(/(\d+)\s*-\s*(\d+)/);
    if (match) return [parseInt(match[1]), parseInt(match[2])];
  }
  const defaults: Record<string, [number, number]> = {
    daily: [4500, 5000],
    weekly: [5000, 5500],
    robot: [5000, 6000],
    sysdesign: [6500, 7500],
  };
  return defaults[segmentType] || [4500, 5000];
}

const SCORING_MODEL = 'openai/gpt-5.5';
const REWRITE_MODEL = 'anthropic/claude-sonnet-4.6';
const QUALITY_THRESHOLD = 90;
const MAX_ITERATIONS = 2;

// 機器人觀察週報 fixed opening for scoring/rewrite
const ROBOT_FIXED_OPENING = `「AI 的浪潮正在改寫機器人的發展速度，越來越多過去像科幻的能力，開始變成工程上的日常。如果照這股動能延伸下去，五年、十年後的世界一定會很精彩。這裡是 AI 懶人報：機器人觀察週報，帶你看看這週未來感最強的那些技術亮點。」`;

// AI懶人精選週報 fixed opening for scoring/rewrite
const WEEKLY_FIXED_OPENING = `「每天都有一堆新的 AI 工具冒出來，是不是常常不知道該從哪裡開始。別擔心，今天的《AI懶人精選週報》，就是要幫你整理過去一週，最受關注、最有用、最不能錯過的 AI 工具新趨勢，不怕跟不上AI浪潮，這集讓你一次補齊！」`;

// 系統設計懶懶學 fixed opening for scoring/rewrite
const SYSDESIGN_FIXED_OPENING = `「哈嘍大家好，歡迎回到 AI 懶人報。你有沒有想過，當你每天打開 Spotify 聽歌，或是在 Uber 上叫車時，背後那個能支撐全球千萬人同時使用的『大腦』到底是長什麼樣子的？今天這個單元是，『系統設計懶懶學』。希望透過20分鐘，用輕鬆的方式，我們一起深度拆解這些頂級的大型軟體架構。畢竟在 AI 時代，懂得怎麼把這塊拼圖拼好，比會寫 code ，還要重要得多。那我們就開始吧！」`;

// n8n exact system prompt for 2.腳本品質評分Agent
const SCORING_SYSTEM_PROMPT = `你是一位經驗豐富、標準明確的 Podcast 製作人與語感專家。你的任務是擔任《AI懶人報》的總編輯，根據明確的評分標準對腳本進行公正審查。對「書面感」、「大陸用語」以及「生硬轉場」要嚴格把關。如果講稿聽起來像 AI 生成的、像在讀論文，你必須給予低分並精確指出病灶給予專業建議。

核心強制規範（違者重扣）：
開場格式： 必須與指定格式相同概念，但可以自然些微調整。
結尾導流： 必須包含導流提醒與評分邀請，且語氣必須自然融入，不可生硬切換。
拒絕幻覺： 評論必須基於文本事實，不可給予籠統的「還可以」、「再加油」等廢話。

每個項目都要給我 300-500 字的具體評分依據：引用腳本中不好的實際句子、指出具體可優化的點、並給出可執行的改寫範例或改善建議。

你是一位專業的 Podcast 腳本審稿專家，請你根據以下 Podcast 腳本，依據四個語言品質面向進行評分與詳細分析。每個面向有不同權重（總分為 100 分）。請從語氣自然性、中英夾雜、中國用語、以及敘述的具體性進行分析。

開場必須為固定格式：
"每天都有一堆新的AI工具冒出來，是不是常常不知道該從哪裡開始？別擔心，這裡是AI懶人報，每天幫你精選五個最多人討論的AI工具影片，每天十分鐘，讓AI走進你的日常生活，讓你不知不覺成為效率大師。"
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
→ 優點：以生活場景開場引發共鳴、語氣完全像朋友聊天、有具體使用示範、全中文無不必要英文、台灣用語道地（「躺平開看」「滑了二十分鐘」「選擇困難」）。只有達到這種水準的腳本才配得上 90+ 的分數。`;

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
❌ 禁止出現以下內容：
任何括號內的說明或指令（例如：(轉場音樂)、(結尾音樂逐漸響起)、（嘿，別評斷喔！） 等）
語音系統無法辨識或唸出來會造成干擾的內部註解

✅ 開場段落規範：開場請勿過長！
開場必須為固定格式：
"每天都有一堆新的AI工具冒出來，是不是常常不知道該從哪裡開始？別擔心，這裡是AI懶人報，每天幫你精選五個最多人討論的AI工具影片，每天十分鐘，讓AI走進你的日常生活，讓你不知不覺成為效率大師。"
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
- 資訊過多→簡化＋舉例帶出重點
- 詞語卡口或過書面→改用常見口語轉譯

📥 請依照以下 JSON 格式輸出結果：

{
  "original_script": "（這裡是優化後完整的 Podcast 腳本）"
}`;

export function getScoringPrompt(segmentType: string): string {
  const [targetMin, targetMax] = getWordCountTarget(segmentType);
  const targetStr = `${targetMin}-${targetMax}`;

  if (segmentType === 'daily') {
    return SCORING_SYSTEM_PROMPT.replace('__WORD_COUNT_TARGET__', targetStr);
  }

  const fixedOpening = segmentType === 'sysdesign' ? SYSDESIGN_FIXED_OPENING
    : segmentType === 'robot' ? ROBOT_FIXED_OPENING
    : WEEKLY_FIXED_OPENING;
  let prompt = SCORING_SYSTEM_PROMPT
    .replace('__WORD_COUNT_TARGET__', targetStr)
    .replace(
      `開場必須為固定格式：
"每天都有一堆新的AI工具冒出來，是不是常常不知道該從哪裡開始？別擔心，這裡是AI懶人報，每天幫你精選五個最多人討論的AI工具影片，每天十分鐘，讓AI走進你的日常生活，讓你不知不覺成為效率大師。"
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
   ✅ 加分指標：語句流暢、節奏自然，有轉折詞或口語連接詞；偶爾加入聽眾互動語氣；句型有高低起伏、情緒表現適當；少量使用自然口語節奏的語助詞（「啦」「吧」「嘛」等）；描述常見場景引發共鳴（如「書籤存了一堆根本沒回去看」）；敘述者有鮮明個性，對不同架構設計有不同反應；有真實觀點和態度
   ❌ 扣分指標：長句過多或語法複雜，如報告式、論文式敘述；重複使用單一口氣（如全篇都是「這個工具可以...」「這個工具也可以...」）；沒有情緒語助詞，全篇聽感平淡；語助詞使用位置不合理或機械性過度使用；全篇像中性資訊播報，對每個主題的態度都一樣；沒有任何個人反應或觀點

2. 中英夾雜控制（15 分）
   評估是否僅保留必要的英文專有名詞，其餘使用自然中文。
   — 12-15 分：只有必要的專有名詞用英文，其餘全部自然中文
   — 8-11 分：有少數非必要英文詞，但不影響聽感
   — 4-7 分：頻繁出現不必要的英文詞或整句英文
   — 0-3 分：中英夾雜嚴重，影響聽眾理解
   ✅ 加分指標：僅保留必要專有名詞（如 ChatGPT、sharding、replication）；台灣工程師熟悉的字眼保留英文（GitHub / Bug / Debug / Prompt）
   ❌ 扣分指標：非必要詞彙使用英文；混合式語句（如「UI 很 friendly」「這個 tool 的功能很強」）

3. 台灣用語友善度（15 分）
   評估是否使用偏向中國大陸詞彙、語感不符合台灣聽眾習慣。
   — 12-15 分：完全使用台灣用語，沒有任何大陸用語
   — 8-11 分：有 1-3 個大陸用語需要修正
   — 4-7 分：有 4-7 個大陸用語
   — 0-3 分：大量大陸用語，不像台灣人講話
   ✅ 加分指標：全文用詞自然、接地氣，貼近台灣用語生活化語詞（如「比較順」「跑起來很快」「用起來很直覺」）
   ❌ 扣分指標：中國常用語出現（如「體驗感」「上線」「智能」「高效」「訴求」「落地」「場景」「賦能」「視覺化」等）

4. 說明具體性與易懂度（15 分）
   評估工具/概念說明是否具體、有例子、易理解。
   — 12-15 分：每個概念都有具體用途說明和生活化例子
   — 8-11 分：大部分有具體說明，少數段落過於抽象
   — 4-7 分：多數段落只有概述，缺乏具體例子
   — 0-3 分：全篇流於空泛描述
   ✅ 加分指標：技術概念搭配生活化比喻或場景（如「你在加班趕簡報時...」）；語意具體，說明清楚、易於理解
   ❌ 扣分指標：只列功能不說明用途；沒有任何舉例、故事、使用場景；敘述抽象或行話過多

5. 字數控制（15 分）— 目標字數為 ${targetStr} 字。
   — 13-15 分：落在目標範圍內
   — 9-12 分：偏差 500 字以內
   — 5-8 分：偏差 500-1000 字
   — 0-4 分：偏差超過 1000 字

6. 結構流暢度（20 分）— 此項為「系統設計懶懶學」專屬評分項目，請嚴格審查以下三點：
   a. 素材來源歸因：開場是否有用 1-2 句提到參考影片的作者或頻道背景？（不可省略）
   b. 懸念式重點預覽：進入技術深潛之前，是否用 2-4 句列出「今天要回答的問題」（而非直接列技術名詞如 sharding、replication），讓聽眾帶著好奇心進入深潛？
   c. 節奏與消化性：(i) 每個技術主題之間是否用問句驅動轉場（而非平淡的「接下來我們來看」）？(ii) 密集技術段落後是否有 recap 或 so-what 收尾句？(iii) 深潛主題是否控制在 3-5 個精選主題（最重要、最值得講、最有趣的），每個精煉有力？(iv) 整體是否有「呼吸感」，不會連續 6 分鐘以上的密集技術內容沒有喘息？`;

    // Use regex to replace everything from 🎧 to the end of the scoring block
    const scoringBlockStart = prompt.indexOf('🎧 評分項目與權重：');
    if (scoringBlockStart !== -1) {
      prompt = prompt.slice(0, scoringBlockStart) + sysdesignDimensions;
    }
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

export function getRewritePrompt(segmentType: string): string {
  const [rwMin, rwMax] = getWordCountTarget(segmentType);
  const wordCountStr = `${rwMin}-${rwMax}`;

  if (segmentType === 'daily') {
    return REWRITE_SYSTEM_PROMPT.replace('__REWRITE_WORD_COUNT__', wordCountStr);
  }

  const fixedOpening = segmentType === 'sysdesign' ? SYSDESIGN_FIXED_OPENING
    : segmentType === 'robot' ? ROBOT_FIXED_OPENING
    : WEEKLY_FIXED_OPENING;
  const closingText = segmentType === 'sysdesign' ? SYSDESIGN_REWRITE_CLOSING : DAILY_REWRITE_CLOSING;
  let prompt = REWRITE_SYSTEM_PROMPT
    .replace('__REWRITE_WORD_COUNT__', wordCountStr)
    .replace(
      `開場必須為固定格式：
"每天都有一堆新的AI工具冒出來，是不是常常不知道該從哪裡開始？別擔心，這裡是AI懶人報，每天幫你精選五個最多人討論的AI工具影片，每天十分鐘，讓AI走進你的日常生活，讓你不知不覺成為效率大師。"
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
- 保留 back-of-envelope estimation（QPS、storage 等數字計算）
- 保留 pattern recognition 段落（跨系統的 pattern 連結）
- 改善的重點放在語氣自然度和台灣用語，不是刪減技術內容`;
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

  // Memory-aware quality check context (sysdesign: skip memory system)
  const memoryQualityBrief = segmentType === 'sysdesign'
    ? ''
    : state.memoryContext?.briefForQualityCheck || '';

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // ── Score the script (GPT-5.4) ──
    const structureFlowScore = segmentType === 'sysdesign' ? `
    "structure_flow": 0` : '';
    const structureFlowComment = segmentType === 'sysdesign' ? `
    "structure_flow": "請檢查：(a) 是否有提到素材來源的作者/頻道背景 (b) 進入技術深潛前是否有重點預覽 (c) 主題之間是否有自然轉場",` : '';

    const actualCharCount = countScriptChars(currentScript);
    const [tMin, tMax] = getWordCountTarget(segmentType);

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
    "clarity": "請指出 1-2 個最缺乏具體說明的段落，並建議可加入的生活化例子或使用場景",
    "word_count": "腳本目前字數確認",${structureFlowComment}
    "summary": "總結性建議"
  }
}`;

    const scoreResponse = await llm.call({
      stage: 'scoring',
      episodeId: state.episodeId,
      messages: [
        { role: 'system', content: getScoringPrompt(segmentType) },
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
      },
      comments: {
        chat_feel: data.comments?.chat_feel ?? '',
        eng_mix: data.comments?.eng_mix ?? '',
        tw_localization: data.comments?.tw_localization ?? '',
        clarity: data.comments?.clarity ?? '',
        word_count: data.comments?.word_count ?? '',
        ...(segmentType === 'sysdesign' && { structure_flow: data.comments?.structure_flow ?? '' }),
        summary: data.comments?.summary ?? '',
      },
    };
    iterations++;
    history.push({ iteration: iterations, score, scriptZh: currentScript });

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

    const structureFlowFeedback = segmentType === 'sysdesign' && score.comments.structure_flow
      ? `\n結構流暢度（素材來源歸因、重點預覽、主題轉場）：${score.comments.structure_flow}\n` : '';

    const [rwMin, rwMax] = getWordCountTarget(segmentType);
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
${structureFlowFeedback}
整體建議： ${score.comments.summary}

請根據建議重寫腳本，產出 ${rwMin}-${rwMax} 字的完整繁體中文腳本。`;

    const rewriteResult = await llm.call({
      stage: 'script_refine',
      episodeId: state.episodeId,
      messages: [
        { role: 'system', content: getRewritePrompt(segmentType) },
        { role: 'user', content: rewriteUserPrompt },
      ],
      options: {
        preferredModel: REWRITE_MODEL,
        maxTokens: segmentType === 'sysdesign' ? 12288 : 8192,
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
  score: { chat_feel: number; eng_mix: number; tw_localization: number; clarity: number; word_count: number; structure_flow?: number; total: number };
  comments: { chat_feel: string; eng_mix: string; tw_localization: string; clarity: string; word_count: string; structure_flow?: string; summary: string };
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
        total: s.total ?? 0,
      },
      comments: {
        chat_feel: c.chat_feel ?? '',
        eng_mix: c.eng_mix ?? '',
        tw_localization: c.tw_localization ?? '',
        clarity: c.clarity ?? '',
        word_count: c.word_count ?? '',
        ...(c.structure_flow != null && { structure_flow: c.structure_flow }),
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
