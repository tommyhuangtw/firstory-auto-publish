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

const HIGHLIGHT_PROMPT_TEMPLATE = ({ episodeTitle, podcastScript, essenceBeats }) => `
你是一位專門做 podcast 短影音 (Reels / Shorts) 的腳本導演。
我會給你一集 podcast 的正式講稿原文以及預選的精華候選段落，請你幫我寫一份 40–60 秒短影音的完整旁白腳本。

這部 Shorts 的旁白全部由樹懶主持人（湯懶懶）用 TTS 合成語音來唸，所以你要寫的是「樹懶主持人用口語跟觀眾分享這集精華」的完整台詞。

【節目資訊】
- 節目：AI 懶人報（每日 AI 精華）
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
  "narration_script": "（30–45 秒能唸完的精華內容旁白。用樹懶主持人的口語把選定主題的重點講述出來，像是在跟朋友聊天分享。要有資訊量、有洞見，讓觀眾快速了解這集的 highlight。穿插自然的驚嘆語助詞如'沒想到'、'這真的太狂了'、'你相信嗎？'、'天啊'、'扯到不行'，但不要每句都加，要自然不做作。繁體中文口語，英文術語保留原拼法如 ChatGPT、Claude Code、API。）",
  "outro_script": "（5–8 秒的 CTA，語氣要興奮，像是'真的很酷對吧？'、'是不是超扯的？'，然後引導觀眾去聽完整集數，結尾必須出現「完整集數連結在資訊欄」這類引導）",
  "broll_keywords": ["3–6 個具體的視覺場景描述", "用英文 2-4 個字的短語", "必須跟精華片段的具體內容直接相關", "例：'person typing code' 而非 'technology'", "例：'robot arm factory' 而非 'AI'", "給 Pexels stock 影片庫搜尋用"],
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

/**
 * Pre-pass: ask Gemini to extract 3–5 "essence" beat candidates from the
 * Airtable script before we do the full highlight selection. This gives the
 * main extractor a curated shortlist instead of a free-form scan, and lets
 * us blacklist intros/outros/ads upfront.
 *
 * @returns {Promise<Array<{text: string, reason: string}>>} — empty array on failure
 */
async function extractEssence({ podcastScript, episodeTitle, openRouter }) {
  if (!podcastScript || !podcastScript.trim()) return [];

  const prompt = `
你是一位專門整理 podcast 精華的編輯。下面是一集 podcast 的完整講稿，請你列出 3–5 個「本集精華」候選段落。每個候選段落的標準：

- 直接從講稿裡**逐字複製**出連續的一段（不要改寫、不要合併）
- 長度大約 30–60 秒能唸完的份量（約 120–200 個中文字）
- 必須是「有資訊量、有洞見、有戲劇轉折，或有具體品牌/產品/數字」的段落
- ❌ 不可以是開場白（「哈囉大家」「歡迎回到」「今天我們要聊」「今天主題」之類）
- ❌ 不可以是結尾 CTA（「記得訂閱」「點資訊欄」「下次見」之類）
- ❌ 不可以是廣告段落（「贊助」「折扣」「課程連結」「限時優惠」「自動化流程」「加入自動化行列」「使用我的折扣碼」「企業 AI 落地」「費用減免」「填表申請」之類）
- ❌ 不可以是「接下來我會介紹」「先講第一個」這種只是段落標題、沒有實質內容的過場句

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
      temperature: 0.4,
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
async function extractHighlight({ episodeTitle, podcastScript, selectedBeat }) {
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
    : await extractEssence({ podcastScript, episodeTitle, openRouter });

  const prompt = HIGHLIGHT_PROMPT_TEMPLATE({
    episodeTitle,
    podcastScript: podcastScript || '',
    essenceBeats,
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
async function generateCoverHeadlines({ selectedBeat, narrationScript }) {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('⚠️  [cover] OPENROUTER_API_KEY not set — returning stub headlines');
    return ['本集精華', 'AI新突破', '不能錯過', '超強工具', '必看重點'];
  }

  const { OpenRouterService } = require('../openRouterService');
  const openRouter = new OpenRouterService();

  const prompt = `
你是一位百萬粉絲 IG Reels 創作者，擅長用短短幾個字讓人停下滑動。根據下面的 podcast highlight 主題，幫我生成 5 個 IG Reels 封面標題。

【主題段落】
${selectedBeat.text}
${selectedBeat.reason ? `\n【主題摘要】\n${selectedBeat.reason}` : ''}
${narrationScript ? `\n【旁白腳本（參考用）】\n${narrationScript}` : ''}

【步驟】
先找出主題中**最核心的產品名/工具名/模型名**（例如 Mythos、Claude Code、GPT-5）作為 core_keyword。

【標題風格指南 — 重要！】
想像觀眾正在高速滑 IG，你的標題要讓他們「停下來」。好的標題會製造**情緒反應**或**好奇心缺口**：

✅ 好的範例（參考這種風格）：
- 「Claude Code 嚇死我了」（情緒衝擊）
- 「GPT-5 要搶你飯碗？」（恐懼 + 好奇）
- 「這 AI 工具免費太扯」（驚訝 + 具體）
- 「Cursor 讓我廢掉了」（自嘲 + 好奇）
- 「3 分鐘做完一天的工作」（數字 + 反差）

❌ 不要這種（太正經、像新聞稿）：
- 「Claude Design：你的專屬設計師」
- 「AI 美感進化論」
- 「○○○神助攻」

【嚴格規則】
1. 每個標題 4–12 字（中文 1 字 = 1，英文算字母數）
2. 每個標題**必須包含 core_keyword 原文**（英文不翻譯）
3. 語氣要像跟朋友聊天，不要像廣告文案或新聞標題
4. 要有**情緒**（驚訝、害怕、興奮、自嘲、好奇）而不只是「介紹」
5. 禁止用「你知道嗎」「必看」「震驚」「神助攻」「救星」「進化論」這些老套詞
6. 5 個標題情緒要不同（驚嘆、疑問、自嘲、恐懼、興奮等）

輸出嚴格 JSON（不要 markdown code fence、不要說明）：
{ "core_keyword": "核心產品名", "headlines": ["標題1", "標題2", "標題3", "標題4", "標題5"] }
`.trim();

  try {
    console.log('🎨 [cover] Generating 5 cover headline candidates...');
    const resp = await openRouter.generateContent(prompt, {
      temperature: 0.7,
      maxTokens: 512,
    });
    if (!resp.success || !resp.content) {
      console.warn('⚠️  [cover] LLM call failed:', resp.error);
      return ['本集精華', 'AI新突破', '不能錯過', '超強工具', '必看重點'];
    }
    const parsed = robustParseJSON(resp.content);
    if (!parsed || !Array.isArray(parsed.headlines) || parsed.headlines.length === 0) {
      console.warn('⚠️  [cover] JSON parse failed or missing headlines[]');
      return ['本集精華', 'AI新突破', '不能錯過', '超強工具', '必看重點'];
    }
    if (parsed.core_keyword) {
      console.log(`   🔑 Core keyword: ${parsed.core_keyword}`);
    }
    console.log(`✅ [cover] Generated ${parsed.headlines.length} headline(s)`);
    return parsed.headlines.slice(0, 5);
  } catch (err) {
    console.warn('⚠️  [cover] generation threw:', err.message);
    return ['本集精華', 'AI新突破', '不能錯過', '超強工具', '必看重點'];
  }
}

module.exports = { extractHighlight, makeStubPlan, extractEssence, generateCoverHeadlines };
