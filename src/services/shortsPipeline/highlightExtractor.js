/**
 * highlightExtractor.js — Use Gemini (via existing OpenRouterService) to
 * generate a full narration script for a 40–60s short video highlight.
 *
 * All-TTS approach: instead of finding clip timestamps in the original audio,
 * Gemini writes a narration script that the sloth character will read via VoAI.
 *
 * Output schema:
 *   {
 *     hook_script: string,            // ~8s opening hook
 *     narration_script: string,       // ~30-45s highlight narration
 *     outro_script: string,           // ~5-8s CTA
 *     broll_keywords: string[],       // 3–6 visual concepts for stock B-roll
 *     headline: string                // a one-line caption for the highlight
 *   }
 *
 * Falls back to a heuristic stub if OpenRouter is unavailable so the rest of
 * the pipeline can still run during development.
 */

require('dotenv').config();

const SEGMENT_SHOW_NAMES = {
  daily: 'AI 懶人報（每日 AI 精華）',
  weekly: 'AI 精選週報',
  robot: '機器人週報',
  sysdesign: '系統架構懶懶學（系統設計拆解 Podcast）',
};

const HIGHLIGHT_PROMPT_TEMPLATE = ({ episodeTitle, podcastScript, essenceBeats, segmentType }) => {
  const showName = SEGMENT_SHOW_NAMES[segmentType] || SEGMENT_SHOW_NAMES.daily;
  const isSysdesign = segmentType === 'sysdesign';

  const sysdesignNarrationExtra = isSysdesign ? `
- 用生活中的比喻來解釋架構概念（例如用奶茶店排隊解釋 message queue）
- 強調系統的規模數字（QPS、用戶量）讓觀眾感受到「這不是小問題」
- 語氣要像「我幫你拆解了一個很酷的系統」` : '';

  const sysdesignBrollExtra = isSysdesign
    ? `"例：'server room data center' 'world map network connections' 'highway traffic aerial' 'warehouse conveyor belt'", "避免太抽象的關鍵字，要有畫面感的具體場景"`
    : '';

  return `
你是一位專門做 podcast 短影音 (Reels / Shorts) 的腳本導演。
我會給你一集 podcast 的正式講稿原文以及預選的精華候選段落，請你幫我寫一份 40–60 秒短影音的完整旁白腳本。

這部 Shorts 的旁白全部由樹懶主持人（湯懶懶）用 TTS 合成語音來唸，所以你要寫的是「樹懶主持人用口語跟觀眾分享這集精華」的完整台詞。

【節目資訊】
- 節目：${showName}
- 本集標題：${episodeTitle || '未提供'}
${podcastScript ? `
【正式講稿（原始文字）】
${podcastScript}
` : ''}${essenceBeats && essenceBeats.length ? `
【本集精華候選（由 essence agent 預先挑出）】
下面是從正式講稿中篩選出來、最適合做成 Shorts 的候選段落。
你的任務是根據選定的候選段落，用樹懶主持人的口語重新詮釋成 Shorts 旁白。
${essenceBeats.map((b, i) => `\n[候選 ${i + 1}] ${b.text}${b.reason ? `\n  （入選理由：${b.reason}）` : ''}`).join('\n')}
` : ''}

【你的任務】
請輸出一份 **嚴格的 JSON**（不要加 markdown 程式碼框、不要任何說明文字），結構如下：

{
  "hook_script": "（8 秒以內的吸睛開場白，由樹懶主持人說。要像跟朋友分享驚人消息一樣，自然加入驚嘆語氣，例如：'沒想到...'、'這真的太狂了'、'你絕對猜不到'、'我真的嚇到了'、'天啊'。台灣口語，製造好奇感，不要劇透精華內容）",
  "narration_script": "（30–45 秒能唸完的精華內容旁白。用樹懶主持人的口語把選定主題的重點講述出來，像是在跟朋友聊天分享。要有資訊量、有洞見，讓觀眾快速了解這集的 highlight。穿插自然的驚嘆語助詞如'沒想到'、'這真的太狂了'、'你相信嗎？'、'天啊'、'扯到不行'，但不要每句都加，要自然不做作。繁體中文口語，英文術語保留原拼法如 ChatGPT、Claude Code、API。${sysdesignNarrationExtra}）",
  "outro_script": "（5–8 秒的 CTA，語氣要興奮，像是'真的很酷對吧？'、'是不是超扯的？'，然後引導觀眾去聽完整集數，結尾必須出現「完整集數連結在資訊欄」這類引導）",
  "broll_keywords": ["3–6 個具體的視覺場景描述", "用英文 2-4 個字的短語", "必須跟精華片段的具體內容直接相關", "例：'person typing code' 而非 'technology'", "例：'robot arm factory' 而非 'AI'", "給 Pexels stock 影片庫搜尋用"${sysdesignBrollExtra ? `, ${sysdesignBrollExtra}` : ''}],
  "headline": "一句 12 字以內的中文標題，會浮在影片上方"
}

【嚴格規則】
1. narration_script 的長度必須在 30–45 秒能唸完的範圍（約 120–200 個中文字），加上 hook_script 和 outro_script 總共 40–60 秒。
2. narration_script 是「重新詮釋」而非逐字複製講稿。用口語化、像跟朋友聊天的方式講述重點。
3. hook_script 不要劇透精華內容，要製造好奇。
4. outro_script 結尾必須出現「完整集數連結在資訊欄」這類引導。
5. broll_keywords 用英文（Pexels stock 影片搜尋用），每個關鍵字必須是 **具體的視覺場景**（2-4 個英文字的短語），而且必須跟精華片段的「具體內容」直接相關。❌ 禁止使用抽象詞彙如 "AI"、"technology"、"innovation"、"cybersecurity"、"data"，這些搜不到有意義的畫面。✅ 好的例子：「person typing code」「server room lights」「robot arm assembly」「smartphone screen close up」「brain neural network 3D」。
6. ⚠️ narration_script **不可以包含廣告內容**（例如「贊助」「折扣」「課程連結」「限時優惠」「自動化流程」「加入自動化行列」「使用我的折扣碼」「企業 AI 落地」「費用減免」「填表申請」之類的品牌推廣段落）。
7. hook_script 和 outro_script 要像 YouTuber/Podcaster 跟朋友聊天的語氣，自然地穿插驚嘆、反問、語助詞（例如「沒想到」「這真的太狂了」「真的很酷」「你相信嗎？」「我真的覺得太屌了」「天啊」「扯到不行」），讓觀眾感受到你的興奮，但不要每句都加，要自然不做作。
8. 只輸出 JSON，不要任何前後說明。
`.trim();
};

/**
 * Pre-pass: ask Gemini to extract 3–5 "essence" beat candidates from the
 * Airtable script before we do the full highlight selection. This gives the
 * main extractor a curated shortlist instead of a free-form scan, and lets
 * us blacklist intros/outros/ads upfront.
 *
 * @returns {Promise<Array<{text: string, reason: string}>>} — empty array on failure
 */
async function extractEssence({ podcastScript, episodeTitle, openRouter, segmentType }) {
  if (!podcastScript || !podcastScript.trim()) return [];

  const isSysdesign = segmentType === 'sysdesign';
  const sysdesignExtra = isSysdesign ? `
🏗️ 系統設計特別要求（本集是系統架構拆解節目）：
- 優先選有「具體規模數字」的段落（QPS、TPS、每秒請求數、用戶量、資料量）
- 優先選有「架構拆解」的段落（Load Balancer、CDN、Message Queue、Cache 的運作原理）
- 優先選有「設計權衡」的段落（consistency vs availability、SQL vs NoSQL、同步 vs 非同步）
- 優先選有「真實系統案例」的段落（Netflix、Uber、Instagram、Twitter 等公司的架構）
- 這些段落做成 Shorts 最能吸引工程師/技術人員的注意
` : '';

  const prompt = `
你是一位專門整理 podcast 精華的編輯。下面是一集 podcast 的完整講稿，請你列出 3–5 個「本集精華」候選段落。每個候選段落的標準：

- 直接從講稿裡**逐字複製**出連續的一段（不要改寫、不要合併）
- 長度大約 30–60 秒能唸完的份量（約 120–200 個中文字）
- 必須是「有資訊量、有洞見、有戲劇轉折，或有具體品牌/產品/數字」的段落
- ❌ 不可以是開場白（「哈囉大家」「歡迎回到」「今天我們要聊」「今天主題」之類）
- ❌ 不可以是結尾 CTA（「記得訂閱」「點資訊欄」「下次見」之類）
- ❌ 不可以是廣告段落（「贊助」「折扣」「課程連結」「限時優惠」「自動化流程」「加入自動化行列」「使用我的折扣碼」「企業 AI 落地」「費用減免」「填表申請」之類）
- ❌ 不可以是「接下來我會介紹」「先講第一個」這種只是段落標題、沒有實質內容的過場句
${sysdesignExtra}
輸出**嚴格 JSON**（不要加 markdown code fence、不要任何前後說明文字）：
{
  "beats": [
    { "text": "......(逐字複製的連續一段)......", "reason": "這段為什麼吸引人" }
  ]
}

【本集標題】${episodeTitle || '未提供'}

【完整講稿】
${podcastScript}
`.trim();

  try {
    console.log('🧠 [essence] Extracting today\'s essence beats from Airtable script...');
    const resp = await openRouter.generateContent(prompt, {
      temperature: 0.6,
      maxTokens: 2048,
    });
    if (!resp.success || !resp.content) {
      console.warn('⚠️  [essence] LLM call failed:', resp.error);
      return [];
    }
    const parsed = robustParseJSON(resp.content);
    if (!parsed || !Array.isArray(parsed.beats)) {
      console.warn('⚠️  [essence] JSON parse failed or missing beats[]');
      return [];
    }
    const beats = parsed.beats
      .filter(b => b && typeof b.text === 'string' && b.text.trim().length >= 30)
      .map(b => ({ text: b.text.trim(), reason: (b.reason || '').trim() }));
    console.log(`✅ [essence] Extracted ${beats.length} beat(s) from Airtable script`);
    return beats;
  } catch (err) {
    console.warn('⚠️  [essence] extraction threw:', err.message);
    return [];
  }
}

/**
 * Generate a full narration plan for the short video.
 *
 * @param {object} args
 * @param {string} [args.episodeTitle]
 * @param {string} [args.podcastScript]  - full podcast script from Airtable
 * @param {object} [args.selectedBeat]   - user-selected beat from previewTopics
 * @returns {Promise<NarrationPlan>}
 */
async function extractHighlight({ episodeTitle, podcastScript, selectedBeat, segmentType }) {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('⚠️  [highlight] OPENROUTER_API_KEY not set — returning STUB highlight plan');
    return makeStubPlan();
  }

  // Lazy require so the module loads even if openRouterService throws on missing key
  const { OpenRouterService } = require('../openRouterService');
  const openRouter = new OpenRouterService();

  // Essence pre-pass — if user already selected a beat, use only that one;
  // otherwise run the full extraction from the script.
  const essenceBeats = selectedBeat
    ? [selectedBeat]
    : await extractEssence({ podcastScript, episodeTitle, openRouter, segmentType });

  const prompt = HIGHLIGHT_PROMPT_TEMPLATE({
    episodeTitle,
    podcastScript: podcastScript || '',
    essenceBeats,
    segmentType,
  });

  console.log('🧠 [highlight] Asking Gemini to write narration script...');
  const resp = await openRouter.generateContent(prompt, {
    temperature: 0.5,
    maxTokens: 2048,
  });

  if (!resp.success || !resp.content) {
    console.warn('⚠️  [highlight] LLM call failed, falling back to stub plan:', resp.error);
    return makeStubPlan();
  }

  const parsed = robustParseJSON(resp.content);
  if (!parsed) {
    console.warn('⚠️  [highlight] JSON parse failed. Raw LLM output:\n' + resp.content.slice(0, 2000));
    console.warn('⚠️  Falling back to stub plan');
    return makeStubPlan();
  }

  return validateAndNormalize(parsed);
}

/**
 * Robust JSON extractor tailored for LLM output. Handles:
 *   - raw JSON
 *   - markdown-fenced ```json ... ``` blocks
 *   - trailing prose/commentary after the JSON
 *   - trailing commas before } or ]
 *   - smart quotes that slipped in
 */
function robustParseJSON(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const attempts = [];

  // 1. Strip markdown fences if present
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    attempts.push(fenceMatch[1].trim());
  }
  attempts.push(text);

  // 2. Find the largest balanced { ... } span (handles nested objects/arrays)
  for (const candidate of [...attempts]) {
    const balanced = extractBalancedObject(candidate);
    if (balanced) attempts.push(balanced);
  }

  // 3. Try each candidate as-is, then with common fixups
  const fixers = [
    (s) => s,
    stripTrailingCommas,
    normaliseSmartQuotes,
    (s) => stripTrailingCommas(normaliseSmartQuotes(s)),
  ];
  for (const candidate of attempts) {
    for (const fixer of fixers) {
      try {
        return JSON.parse(fixer(candidate));
      } catch (_) { /* try next */ }
    }
  }
  return null;
}

/**
 * Walk the string and return the first balanced { ... } block by brace counting,
 * respecting string literals and escapes. Returns null if none found.
 */
function extractBalancedObject(s) {
  const openIdx = s.indexOf('{');
  if (openIdx < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(openIdx, i + 1);
    }
  }
  return null;
}

function stripTrailingCommas(s) {
  return s.replace(/,(\s*[}\]])/g, '$1');
}

function normaliseSmartQuotes(s) {
  return s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
}

function validateAndNormalize(plan) {
  return {
    hook_script: plan.hook_script || '哈囉，我是樹懶，今天有件事你一定要知道。',
    narration_script: plan.narration_script || '',
    outro_script: plan.outro_script || '想聽完整內容，記得點下方資訊欄連結，按下訂閱不迷路。',
    broll_keywords: Array.isArray(plan.broll_keywords) && plan.broll_keywords.length
      ? plan.broll_keywords
      : ['ai technology', 'typing on laptop', 'futuristic interface'],
    headline: plan.headline || '本集精華',
  };
}

/**
 * Deterministic stub for development/fallback.
 */
function makeStubPlan() {
  return {
    hook_script: '哈囉我是樹懶，這集我要告訴你一個你絕對不能錯過的 AI 大消息！',
    narration_script: '今天要跟大家分享一個超厲害的 AI 新突破，這個技術真的讓我嚇到了。簡單來說，它可以讓原本需要好幾天才能完成的工作，現在幾分鐘就搞定。你相信嗎？而且最厲害的是，這個工具完全免費開放給大家使用。',
    outro_script: '是不是超扯的？想聽更完整的分析，完整集數連結在資訊欄，記得按下訂閱不迷路！',
    broll_keywords: ['ai robot', 'typing on laptop', 'futuristic interface', 'data visualization'],
    headline: '本集精華',
    _stub: true,
  };
}

/**
 * Generate 5 cover headline candidates for IG Reels.
 * Rules: 4–9 chars, must include main product/tool/mindset from the topic.
 *
 * @param {object} args
 * @param {object} args.selectedBeat  – the user-selected beat
 * @param {string} [args.narrationScript] – narration for extra context
 * @returns {Promise<string[]>}
 */
async function generateCoverHeadlines({ selectedBeat, narrationScript, segmentType }) {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('⚠️  [cover] OPENROUTER_API_KEY not set — returning stub headlines');
    return ['本集精華', 'AI新突破', '不能錯過', '超強工具', '必看重點', '這集必聽', '太扯了', '你猜不到'];
  }

  const { OpenRouterService } = require('../openRouterService');
  const openRouter = new OpenRouterService();

  const isSysdesign = segmentType === 'sysdesign';

  const formulasSection = isSysdesign ? `
【封面標題公式 — 8 個標題，盡量用不同公式】
⚠️ 注意：這些是「封面上的大字」，不是文章標題。想像印在影片封面上、佔滿畫面的粗體字。
🎯 核心定位：這個節目就是幫大家「揭密」那些超強軟體/系統背後到底怎麼運作的。標題要讓人一看就知道「哦這集要拆解某個很厲害的東西」。

1. **揭密拆解**（最重要的公式，至少 3 個標題用這個變體）：
   用「揭密」「拆解」「解密」搭配具體系統名，寫成一句自然的話
   ✅ 「揭密Uber的GPS定位系統」「拆解Netflix怎麼不當機」「解密IG限動的傳送機制」
   變體：也可以用「[系統名]的秘密」「[系統名]怎麼做到的」
   ✅ 「Uber永不斷線的秘密」「Netflix串流背後的真相」

2. **規模數字衝擊**：用最震撼的數字搭配系統名
   ✅ 「Uber每秒60萬次寫入」「Netflix 3億人同時串流」「IG一天處理20億張照片」

3. **日常vs規模**：日常小動作 vs 背後驚人規模
   ✅ 「叫車只要3秒背後忙了30步」「按一個讚就要通知全世界」

4. **反差短句**：看起來簡單但其實超複雜
   ✅ 「一次搜尋動用萬台伺服器」「一條訊息跑了半個地球」

5. **比喻秒懂**：用生活比喻讓架構秒懂
   ✅ 「CDN就是全球零食藏寶圖」「Message Queue就是號碼牌」

6. **結果前置**：先丟出驚人結論
   ✅ 「撐住雙11的架構長這樣」「從0到1億用戶的秘密」

7. **挑戰式**：直球挑戰觀眾
   ✅ 「你設計得出Uber嗎」「這題面試直接考倒人」

8. **FOMO 焦慮**：工程師會焦慮的一句話
   ✅ 「不懂這架構面試直接掰」「資深工程師都在學的概念」
` : `
【封面標題公式 — 8 個標題，盡量用不同公式】
⚠️ 注意：這些是「封面上的大字」，不是文章標題。想像印在影片封面上、佔滿畫面的粗體字。

1. **數字衝擊**：用具體數字製造反差感
   ✅ 「一個Prompt省下8小時」「月賺10萬的AI副業」「3天學完 年薪多50萬」

2. **結果前置**：直接講驚人結果
   ✅ 「不寫程式也能做出App」「一個人管500支影片」「它自己學會了投資」

3. **FOMO 焦慮**：讓人覺得「不看就虧了」
   ✅ 「同事偷偷在學的工具」「免費不知道還有多久」「3年內會消失的工作」

4. **反常識**：打破認知讓人驚訝
   ✅ 「AI寫的日記比我還誠實」「它考試贏了99%的人」「機器人來面試你敢嗎」

5. **第一人稱反應**：像朋友脫口而出的真實反應
   ✅ 「用完這工具我失業了」「被AI嗆了一整天」「用完就回不去了」

6. **比喻秒懂**：一個比喻讓人秒懂
   ✅ 「它就是你的24小時秘書」「AI版抄筆記大神來了」「你的數位分身上線了」

7. **對比衝擊**：before/after 極端對比
   ✅ 「以前寫一天現在10分鐘」「人寫vs AI寫你分得出來嗎」

8. **懸念鉤子**：讓人想知道「然後呢？」
   ✅ 「讓AI管我的錢結果」「用了一個月後回不去了」
`;

  const antiPatterns = isSysdesign ? `
【絕對禁止 — 犯了直接不及格】
❌ 太長像文章標題：「Uber 不會斷線，GPS 定位背後的黑科技！」
   → 封面字太多讀不完，要砍到 10 字以內
❌ 加標點符號：「是怎麼做到的？」「背後的黑科技！」
   → 封面不需要「？」「！」「，」，浪費空間
❌ 像課程廣告：「系統設計完全攻略」「架構設計入門」
❌ 太抽象：「系統設計大揭秘」「後端技術」
❌ 解釋性語句：「是怎麼做到的」「背後的黑科技」「比你想像的忙」
   → 這些是補充說明，不是封面標題
` : `
【絕對禁止 — 犯了直接不及格】
❌ 太長像文章標題：「AI 助手幫我賺錢，你也可以試試看！」
   → 封面字太多讀不完，要砍到 10 字以內
❌ 加標點符號：結尾的「？」「！」「，」
   → 封面不需要標點，浪費空間
❌ 太籠統：「AI 助手」「AI 工具」「這個 AI」「AI 新突破」
   → 必須換成具體的產品名或動作
❌ 像新聞標題：「Claude Design：你的專屬設計師」
❌ 解釋性語句：「是怎麼做到的」「背後的原理」
   → 這些是補充說明，不是封面標題
`;

  const prompt = `
你是 IG Reels 封面文案專家。你要寫的是「影片封面上的大字」——印在 9:16 影片上、佔滿畫面的粗體字。不是文章標題，不是 clickbait，是「封面視覺文字」。

想像觀眾在 IG 滑動，你的封面文字要在 0.3 秒內讓人停下來。
${isSysdesign ? '\n🎯 這個節目的核心賣點：幫觀眾「揭密/拆解」那些超強軟體和系統背後到底怎麼運作的。標題要讓人一看就知道「這集要拆解某個很厲害的東西」。\n' : ''}
我給你一段 podcast 精華主題，請生成 8 個封面標題。

【主題段落】
${selectedBeat.text}
${selectedBeat.reason ? `\n【為什麼選這段】\n${selectedBeat.reason}` : ''}
${narrationScript ? `\n【旁白腳本（參考用）】\n${narrationScript}` : ''}

【你的任務 — 分兩步】

**Step 1**: 找出最有衝擊力的**核心關鍵字**。
${isSysdesign
    ? `- 找出這段講的是哪個系統/產品/公司（如 Uber、Netflix、Instagram）
- 找出最震撼的數字或架構概念
- core_keyword = 系統名 + 核心概念（如「Uber GPS」「Netflix CDN」）`
    : `- 如果有具體產品名/工具名（如 Claude Code、GPT-5），用它
- 如果沒有，找最具體的**動作或結果**（如「AI 自動操盤」「月賺一萬美金」）
- ⚠️ 絕對不要用「AI 助手」「AI 工具」「這個 AI」`}

**Step 2**: 用下面的公式生成 8 個封面標題。
${formulasSection}
${antiPatterns}
【嚴格字數規則 — 最重要！】
1. 每個標題 **8–15 個字**（中文 1 字 = 1，英文單字 = 1，數字 = 1）
2. **禁止標點符號**——不要「！」「？」「，」「：」「...」「/」。封面上不需要任何符號
3. 每個標題就是一句完整的短句，不要用斜線或任何分隔符號拆成兩半
4. 盡量每個標題用不同公式
5. 語氣 = 封面大字，像路邊看板一樣短促有力
6. 8 個標題的**開頭必須不同**
7. 如果主題有具體產品名/系統名，至少 4 個標題要包含它
${isSysdesign ? `8. ⚠️ 至少 3 個標題要帶有「揭密」「拆解」「解密」「秘密」「怎麼做到」等揭密拆解的語感——讓觀眾一看就知道這集是要幫他們看懂厲害系統的內幕` : ''}

輸出嚴格 JSON（不要 markdown code fence、不要說明）：
{ "core_keyword": "核心關鍵字", "headlines": ["標題1", "標題2", "標題3", "標題4", "標題5", "標題6", "標題7", "標題8"] }
`.trim();

  try {
    console.log('🎨 [cover] Generating 8 cover headline candidates...');
    const resp = await openRouter.generateContent(prompt, {
      temperature: 0.85,
      maxTokens: 768,
    });
    if (!resp.success || !resp.content) {
      console.warn('⚠️  [cover] LLM call failed:', resp.error);
      return ['本集精華', 'AI新突破', '不能錯過', '超強工具', '必看重點', '這集必聽', '太扯了', '你猜不到'];
    }
    const parsed = robustParseJSON(resp.content);
    if (!parsed || !Array.isArray(parsed.headlines) || parsed.headlines.length === 0) {
      console.warn('⚠️  [cover] JSON parse failed or missing headlines[]');
      return ['本集精華', 'AI新突破', '不能錯過', '超強工具', '必看重點', '這集必聽', '太扯了', '你猜不到'];
    }
    if (parsed.core_keyword) {
      console.log(`   🔑 Core keyword: ${parsed.core_keyword}`);
    }
    console.log(`✅ [cover] Generated ${parsed.headlines.length} headline(s)`);
    // Strip any slash separators or trailing punctuation the LLM may still add
    return parsed.headlines.slice(0, 8).map(h =>
      h.replace(/\//g, ' ').replace(/[！？!?，,：:…]+$/g, '').trim()
    );
  } catch (err) {
    console.warn('⚠️  [cover] generation threw:', err.message);
    return ['本集精華', 'AI新突破', '不能錯過', '超強工具', '必看重點', '這集必聽', '太扯了', '你猜不到'];
  }
}

module.exports = { extractHighlight, makeStubPlan, extractEssence, generateCoverHeadlines };
