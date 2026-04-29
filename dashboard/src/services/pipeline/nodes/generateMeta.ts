/**
 * Stage 6: Generate Meta — Titles, Description, Tags.
 *
 * Ported from src/services/contentGenerator.js.
 * Generates 10 title candidates, selects best, creates description and tags.
 */

import { getLLMService } from '@/services/llmService';
import { getDb } from '@/db';
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
  const isWeekly = state.segmentType === 'weekly';
  const isSysdesign = state.segmentType === 'sysdesign';

  // Step 0: Summarize full script → used by all downstream prompts
  const summary = await summarizeScript(content, state.segmentType, state.episodeId);
  log.info({ summaryLength: summary.length }, 'Script summarized for meta generation');

  // Persist summary to DB
  try {
    const db = getDb();
    db.prepare('UPDATE episodes SET script_summary = ? WHERE id = ?')
      .run(summary, state.episodeId);
  } catch { /* non-critical */ }

  // Step 1: Generate 10 title candidates + select best (combined in one LLM call)
  const titlePrompt = isSysdesign ? buildSysdesignTitlePrompt(summary)
    : isRobot ? buildRobotTitlePrompt(summary)
    : isWeekly ? buildWeeklyTitlePrompt(summary)
    : buildTitlePrompt(summary);
  const titlesResult = await llm.generateJSON<{ titles: string[]; bestIndex: number; bestTitle: string }>(
    titlePrompt,
    'title_gen',
    { episodeId: state.episodeId, maxTokens: 2048, temperature: 0.7 }
  );

  const candidateTitles = titlesResult.success && titlesResult.data?.titles
    ? titlesResult.data.titles
    : getFallbackTitles();

  let selectedTitle = candidateTitles[0];
  if (titlesResult.success && titlesResult.data?.bestIndex) {
    const idx = (titlesResult.data.bestIndex || 1) - 1;
    if (idx >= 0 && idx < candidateTitles.length) {
      selectedTitle = candidateTitles[idx];
    }
  }

  log.info({ count: candidateTitles.length, selectedTitle: selectedTitle.slice(0, 50) }, 'Titles generated and best selected');

  // Step 3: Generate description (source links appended deterministically after LLM generation)
  const descPrompt = isSysdesign ? buildSysdesignDescriptionPrompt(summary)
    : isRobot ? buildRobotDescriptionPrompt(summary)
    : isWeekly ? buildWeeklyDescriptionPrompt(summary)
    : buildDescriptionPrompt(summary);
  const descResult = await llm.generateJSON<{ description: string }>(
    descPrompt,
    'description_gen',
    { episodeId: state.episodeId, maxTokens: 1024, temperature: 0.7 }
  );

  const description = descResult.success && descResult.data?.description
    ? descResult.data.description
      .replace(/.*drive\.google\.com.*\n?/g, '')
      .replace(/.*點擊這裡收聽.*\n?/g, '')
      .trim()
    : getFallbackDescription();

  // YouTube description reuses podcast description (format differences handled by descriptionAssembler)

  // Step 4: Generate tags
  const tagsResult = await llm.generateJSON<{ tags: string[] }>(
    buildTagsPrompt(summary, selectedTitle),
    'tags_gen',
    { episodeId: state.episodeId, maxTokens: 512, temperature: 0.5 }
  );

  const tags = tagsResult.success && tagsResult.data?.tags
    ? tagsResult.data.tags
    : getFallbackTags();

  // Append source links (sysdesign only) — deterministic, not LLM-generated
  let finalDescription = description;
  if (isSysdesign && (state.sourceLinks || []).length > 0) {
    const linksText = state.sourceLinks.map(l => `${l.title}\n${l.url}`).join('\n\n');
    finalDescription += `\n\n---\n📎 參考資料：\n\n${linksText}`;
  }

  log.info({ descLength: finalDescription.length, tagCount: tags.length }, 'Meta generation complete');

  return {
    scriptSummary: summary,
    candidateTitles,
    selectedTitle,
    description: finalDescription,
    youtubeDescription: finalDescription,
    tags,
    status: 'tts',
  };
}

// ── Script Summarization ──

async function summarizeScript(
  content: string,
  segmentType: string,
  episodeId?: number,
): Promise<string> {
  const llm = getLLMService();

  const segmentContext = segmentType === 'sysdesign'
    ? '系統設計懶懶學'
    : segmentType === 'robot'
    ? '機器人觀察週報'
    : segmentType === 'weekly'
    ? 'AI懶人精選週報'
    : 'AI懶人報（每日）';

  const prompt = `你是一位 Podcast 內容分析專家。請將以下「${segmentContext}」的完整腳本濃縮成一份結構化摘要，確保不遺漏任何重要工具或主題。

完整腳本：
${content}

請產出以下結構的摘要（約 800 字）：

1. **本集主題**（1-2 句）：本集的核心主題是什麼？

2. **提到的工具/品牌**（列表）：列出所有提到的 AI 工具、公司或品牌名稱，以及它們的關鍵更新或功能亮點。格式：
   - 工具名稱：一句話描述亮點

3. **主要論點與觀點**（3-5 點）：腳本中最有力的論述、爭議性觀點、或令人驚訝的發現

4. **數據與具體成果**：提到的任何具體數字、百分比、價格、速度比較等

5. **結論/呼籲行動**（1-2 句）：腳本的結論或主要 takeaway

以純文字回傳摘要（不需要 JSON 格式）。`;

  const result = await llm.generate(
    prompt,
    'script_summary',
    { episodeId, maxTokens: 2048, temperature: 0.3 }
  );

  if (result.success && result.content) {
    return result.content.trim();
  }

  // Fallback: use first 3000 chars if summarization fails
  log.warn('Script summarization failed, falling back to truncation');
  return content.slice(0, 3000);
}

// ── Prompt Builders (ported from contentGenerator.js) ──

function buildTitlePrompt(summary: string): string {
  return `你是一位經驗豐富的 Podcast 製作人，專門打造高下載量的標題。根據 297 集的下載數據分析（Top 60 平均 1,250 下載 vs 中段 750 vs Bottom 250），以下模式能顯著提升點擊率。請根據內容生成10個標題。

內容摘要：
${summary}

── 高下載量的 6 大爆款模式（每個標題至少要使用 1 個模式）──

模式A「顛覆性問句」(+35% 下載)：挑戰現有認知，製造 FOMO
  例：「RAG 真的要涼了？深入解析「超長上下文」大戰，以及 2026 企業級代理AI 部署的新標準」(1,454 下載)
  例：「Google 搜尋過時了？這7款 AI 工具讓你工作效率飆升，從此告別瞎忙人生！」(1,441 下載)

模式B「實測/實戰 + 具體數字」(+30% 下載)：第一人稱體驗感 + 數字創造可信度
  例：「Claude Design 實測！16分鐘打造影片、網站、App，設計師們真的要緊張了？」(1,336 下載)
  例：「試過 500+ AI 工具後，這 20 個幫我年收百萬！你還在用手動工作？」(1,313 下載)
  關鍵：「實測」「實戰」比「教學」「介紹」更能衝高點擊

模式C「大品牌 + 強動詞」(+25% 下載)：知名品牌搭配爆炸性動詞
  例：「Claude Dispatch 殺瘋了！OpenClaw 準備被取代？這新功能讓你程式碼寫到飛起！」(1,245 下載)
  例：「Claude Code 2.0 終於來了！Anthropic 這波操作，讓你的程式碼效率直接起飛！」(1,374 下載)

模式D「免費/賺錢鉤子」(+28% 下載)：直擊錢包痛點
  例：「Google Jules 2.0 免費升級！這個 AI 寫程式工具太神，開發者必看！」(6,668 下載)
  例：「Claude Code 免費啦！OpenRouter 讓你零成本玩轉 AI 寫程式，還不快衝？」(1,144 下載)
  例：「2026年想靠 AI 賺錢？這4個給新手的 AI 副業，讓你輕鬆入門，錢包快速變厚！」(1,304 下載)

模式E「秘密/禁止/危險」(+22% 下載)：製造好奇心缺口
  例：「Claude Mythos 被 Anthropic 封鎖？太危險！一般人根本不能碰的神秘AI模型。」(1,295 下載)
  例：「Claude Code 竟讓資料憑空消失！工程師親揭恐怖真相：AI 代理真的能失控？」(1,103 下載)

模式F「版本號新聞感」(+40% 下載)：工具名 + 版本號製造「最新消息」緊迫感
  例：「Google Jules 2.0 免費升級！這個 AI 寫程式工具太神，開發者必看！」(6,668 下載)
  例：「Claude Code 2.0 終於來了！Anthropic 這波操作，讓你的程式碼效率直接起飛！」(1,374 下載)
  例：「Google Gemma 4 震撼登場！新功能超乎想像，AI 個人助理變超神！」(1,222 下載)
  關鍵：版本號讓聽眾覺得是「新聞」而非「舊文」，緊迫感提升點擊

── 必須避免的 5 大雷區（會導致低下載量）──
❌ 用聽眾不認識的小工具當主角（如 TuriX、Auto Whisk、Orchids）→ 改用知名品牌帶流量
❌ 太技術導向（如 "Guardrails"、"gRPC"、"RAG API"）→ 改用白話描述效果
❌ 模糊形容詞（如 "威力驚人"、"太神了"、"創造奇蹟"）→ 改用具體數字或成果
❌ 純教學標題（如 "n8n 搭配 AI Agent"、"一步步教學"）→ 改用故事或成果包裝
❌ 標題太短（< 30 字）→ 資訊量不足，聽眾無法判斷值不值得聽（Bottom 30 平均只有 22 字）

── 基本規則 ──
1. 標題長度 35-45 字
2. 包含 1-2 個知名度高的 AI 工具/品牌名
3. 使用臺灣繁體中文用語
4. 不要加 EPxx 集數編號
5. 不要加類型標記（如【資訊型】）
6. 優先使用「雙段式結構」：前段 hook（新聞/免費/實測）＋後段 payoff（效果/衝擊/行動）
   好：「Claude Code 免費啦！OpenRouter 讓你零成本玩轉 AI 寫程式，還不快衝？」(1,144 下載)
   壞：「免費 AI 程式碼工具推薦」

── 10 個標題的模式分配 ──
• 2 個用模式A（顛覆性問句）
• 2 個用模式B（實測+數字）
• 2 個用模式C（大品牌+強動詞）
• 2 個用模式D（免費/賺錢）
• 1 個用模式E（秘密/危險）
• 1 個用模式F（版本號新聞感）

生成完 10 個標題後，請同時從中選出最可能衝高下載量的標題。

── 選擇評分依據（根據 297 集下載數據）──
加分模式（每命中一個 +10 分）：A 顛覆性問句、B 實測+數字、C 大品牌+強動詞、D 免費/賺錢、E 秘密/危險、F 版本號新聞感
額外加分：+8 雙段式結構、+5 內容相關度高、+3 知名品牌、+2 長度 35-45 字
扣分雷區（每踩一個 -15 分）：小工具當主角、太技術、模糊形容詞、純教學式、標題太短

以 JSON 格式回傳：
{ "titles": ["標題1", "標題2", ..., "標題10"], "bestIndex": 1, "bestTitle": "完整標題", "reason": "選擇理由" }

bestIndex 為 1-based 索引。`;
}

function buildRobotTitlePrompt(summary: string): string {
  return `你是一位專注於機器人科技的 Podcast 製作人，專門打造高下載量的標題。根據 297 集下載數據分析，請根據以下「機器人觀察週報」內容生成10個標題。

內容摘要：
${summary}

── 高下載量的 5 大爆款模式（每個標題至少用 1 個）──

模式A「顛覆性問句」：挑戰認知、製造 FOMO
  例：「AI 機器人失控警告！OpenAI ChatGPT、Anthropic Claude 會是下一個危險因子嗎？揭露專家最擔憂的真相！」(1,111 下載)
  例：「你的車95%時間在吃灰？無人計程車24小時不打烊，Uber 如何變身「派單大總管」？」

模式B「具體數字 + 衝擊感」：
  例：「Open-Source 機器手臂 reBot 只要 $1K？物理 AI 硬體門檻將被徹底打破！」
  例：「Pokémon Go 玩家竟是機器人訓練師？CNN 揭露遊戲數據如何打造 AI 送貨機器人！」(1,078 下載)

模式C「大品牌 + 強動詞」：Tesla、NVIDIA、Boston Dynamics、Disney 等帶流量
  例：「NVIDIA GTC 2026 震撼彈！黃仁勳牽手 Disney 打造《冰雪奇緣》Olaf 活體機器人，未來已來！」(1,115 下載)
  例：「Elon Musk 押寶 Optimus！AI 機器人將取代人類？未來世界比你想的更科幻！」

模式D「秘密/恐懼/未來衝擊」：
  例：「AI 告白：留著人類只因「有利用價值」？聽完毛骨悚然的機器人真心話」(1,060 下載)
  例：「中國「屠殺機器人」上線！AI 操控的軍隊，Siri 變成殺人機器只是時間問題？」

模式E「版本號/事件新聞感」：特定事件或產品版本製造緊迫感
  例：「NVIDIA GTC 2026 震撼彈！」「Figure AI 機器人進化速度超乎想像」
  關鍵：讓聽眾覺得是「新聞」而非「舊文」

── 必須避免 ──
❌ 沒人認識的小公司/品牌當主角
❌ 太技術（純規格、型號）→ 用白話講影響
❌ 模糊形容詞 → 用具體場景或數字
❌ 標題太短（< 30 字）→ 資訊量不足

── 基本規則 ──
1. 包含 1-2 個知名機器人品牌/公司名（Tesla Optimus, Figure, Boston Dynamics, Unitree, Waymo, NVIDIA 等）
2. 標題長度 35-45 字，臺灣繁體中文
3. 不要加 EPxx 或類型標記
4. 不要在標題中加入「週報」「本週精選」「一週回顧」等詞彙（系統會自動加上）
5. 優先使用「雙段式結構」：前段 hook（新聞/事件）＋後段 payoff（衝擊/未來影響）
   好：「NVIDIA GTC 2026 震撼彈！黃仁勳牽手 Disney 打造 Olaf 活體機器人，未來已來！」
   壞：「NVIDIA 機器人技術介紹」

生成完 10 個標題後，請同時從中選出最可能衝高下載量的標題。

── 選擇評分依據 ──
加分模式（每命中一個 +10 分）：A 顛覆性問句、B 具體數字+衝擊感、C 大品牌+強動詞、D 秘密/恐懼/未來衝擊、E 版本號/事件新聞感
額外加分：+8 雙段式結構、+5 內容相關度高、+3 知名品牌、+2 長度適中
扣分雷區（每踩一個 -15 分）：小公司當主角、太技術、模糊形容詞、標題太短

以 JSON 格式回傳：
{ "titles": ["標題1", ..., "標題10"], "bestIndex": 1, "bestTitle": "完整標題", "reason": "選擇理由" }

bestIndex 為 1-based 索引。`;
}

function buildWeeklyTitlePrompt(summary: string): string {
  return `你是一位經驗豐富的 Podcast 製作人，專門製作《AI懶人精選週報》。根據 297 集的下載數據分析（Top 60 平均 1,250 下載 vs 中段 750 vs Bottom 250），以下模式能顯著提升點擊率。請根據本週精選內容生成10個標題。

內容摘要：
${summary}

── 高下載量的 6 大爆款模式（每個標題至少要使用 1 個模式）──

模式A「顛覆性問句」(+35% 下載)：挑戰現有認知，製造 FOMO
  例：「OpenAI 這週放的大招，會讓 Google 睡不著覺？全面開戰！」(1,200+ 下載)
  例：「這週 AI 圈最大震撼：免費模型竟然打贏付費的？GPT 地位不保」(1,100+ 下載)

模式B「實測/盤點 + 具體數字」(+30% 下載)：第一人稱體驗感 + 數字創造可信度
  例：「一週 12 個重磅更新！Claude、GPT、Gemini 誰贏了？實測告訴你」(1,200+ 下載)
  例：「本週必看 5 大 AI 工具更新，第3個直接省你50%時間」(1,000+ 下載)
  關鍵：「實測」「盤點」比「介紹」「教學」更能衝高點擊

模式C「大品牌 + 強動詞」(+25% 下載)：知名品牌搭配爆炸性動詞
  例：「Claude Code 2.0 終於來了！效率直接起飛，開發者必看」(1,374 下載)
  例：「Google 放大絕！Gemini 免費版功能暴增，OpenAI 慌了」(1,200+ 下載)

模式D「免費/賺錢鉤子」(+40% 下載)：直擊錢包痛點，「免費」是最強單一 hook
  例：「Google 本週送大禮！3個免費 AI 工具搶先體驗，手慢就沒了」(1,200+ 下載)
  例：「這週最值得收藏的免費 AI 工具，錯過再等一年」(1,100+ 下載)
  關鍵：「免費」平均下載 1,200+，是 Top 60 出現 7 次的最強 hook

模式E「秘密/危險/獨家」(+22% 下載)：製造好奇心缺口
  例：「Anthropic 到底在隱瞞什麼？Claude Opus 偷偷變弱，用戶暴怒」(1,000+ 下載)
  例：「這週 AI 圈不想讓你知道的3件事，最後一個太離譜」(1,000+ 下載)

模式F「版本號新聞感」(+40% 下載)：工具名 + 版本號製造「最新消息」緊迫感
  例：「Google Jules 2.0 免費升級！這個 AI 寫程式工具太神，開發者必看！」(6,668 下載)
  例：「GPT-5.4 正式發布！這次 OpenAI 終於超越 Claude？完整比較」(1,500+ 下載)
  關鍵：版本號讓聽眾覺得是「新聞」而非「舊文」，緊迫感提升點擊

── 必須避免的 5 大雷區（會導致低下載量）──
❌ 用聽眾不認識的小工具當主角（如 TuriX、Auto Whisk）→ 改用知名品牌帶流量
❌ 太技術導向（如 "Guardrails"、"gRPC"）→ 改用白話描述效果
❌ 模糊形容詞（如 "威力驚人"、"太神了"）→ 改用具體數字或成果
❌ 純教學標題（如 "n8n 搭配 AI Agent"）→ 改用故事或成果包裝
❌ 標題太短（< 30 字）→ 資訊量不足，聽眾無法判斷值不值得聽（Bottom 30 平均只有 22 字）

── 基本規則 ──
1. 標題長度 35-45 字
2. 包含 1-2 個本週最熱門的 AI 工具/品牌名
3. 使用臺灣繁體中文用語
4. 不要加 EPxx 集數編號
5. 不要加類型標記（如【資訊型】）
6. 不要在標題中加入「週報」「本週精選」「一週回顧」「精選週報」等詞彙（系統會自動加上）
7. 優先使用「雙段式結構」：前段 hook（新聞/免費/實測）＋後段 payoff（效果/衝擊/行動）
   好：「Claude Code 免費啦！OpenRouter 讓你零成本玩轉 AI 寫程式，還不快衝？」(1,144 下載)
   壞：「免費 AI 程式碼工具推薦」

── 10 個標題的模式分配 ──
• 2 個用模式A（顛覆性問句）
• 2 個用模式B（實測/盤點+數字）
• 2 個用模式C（大品牌+強動詞）
• 2 個用模式D（免費/賺錢）
• 1 個用模式E（秘密/危險）
• 1 個用模式F（版本號新聞感）

生成完 10 個標題後，請同時從中選出最可能衝高下載量的標題。

── 選擇評分依據（根據 297 集下載數據）──
加分模式（每命中一個 +10 分）：A 顛覆性問句、B 實測+數字、C 大品牌+強動詞、D 免費/賺錢、E 秘密/危險、F 版本號新聞感
額外加分：+8 雙段式結構、+5 內容相關度高、+3 知名品牌、+2 長度 35-45 字
扣分雷區（每踩一個 -15 分）：小工具當主角、太技術、模糊形容詞、純教學式、標題太短

以 JSON 格式回傳：
{ "titles": ["標題1", "標題2", ..., "標題10"], "bestIndex": 1, "bestTitle": "完整標題", "reason": "選擇理由" }

bestIndex 為 1-based 索引。`;
}

function buildSysdesignTitlePrompt(summary: string): string {
  return `你是一位專注於系統設計教學的 Podcast 製作人，專門打造高下載量的標題。請根據以下「系統設計懶懶學」內容生成10個標題。

內容摘要：
${summary}

── 高下載量的爆款模式（每個標題至少用 1 個）──

模式A「面試必考句型」：直擊系統設計面試痛點
  例：「面試必考！Uber 叫車系統背後的即時調度架構大揭密」
  例：「Google 面試官最愛問的系統設計題：設計一個 URL Shortener」

模式B「數字 + 規模衝擊」：用數字展現系統規模
  例：「每秒處理 100 萬筆請求！Netflix 串流背後的架構有多狂？」
  例：「10 億用戶的資料怎麼存？Google Drive 的分散式架構拆解」

模式C「知名系統 + 拆解動詞」：用大品牌帶流量
  例：「Spotify 推薦系統大拆解！為什麼它比你更懂你的音樂品味？」
  例：「Tinder 的配對演算法怎麼運作？從 swipe 到 match 的架構設計」

模式D「對比 / 選擇困境」：引發好奇心
  例：「SQL vs NoSQL 到底怎麼選？看 Instagram 的選擇就知道了」
  例：「微服務 vs 單體架構：Uber 用血淚教你怎麼選」

── 必須避免 ──
❌ 太學術或教科書感（如「分散式系統理論探討」）
❌ 沒有具體系統的抽象標題
❌ 純技術規格（如「CAP 定理推導」）
❌ 標題太短（< 30 字）→ 資訊量不足，聽眾無法判斷值不值得聽

── 基本規則 ──
1. 標題長度 35-50 字
2. 包含 1 個知名系統/品牌名
3. 使用臺灣繁體中文用語
4. 不要加 EPxx 集數編號
5. 不要在標題中加入「懶懶學」（系統會自動加上）
6. 優先使用「雙段式結構」：前段 hook（面試/規模/品牌）＋後段 payoff（拆解/學到什麼）
   好：「面試必考！Uber 叫車系統背後的即時調度架構大揭密，學會直接加薪」
   壞：「Uber 系統設計介紹」

生成完 10 個標題後，請同時從中選出最可能衝高下載量的標題。

── 選擇評分依據 ──
加分模式（每命中一個 +10 分）：A 面試必考句型、B 數字+規模衝擊、C 知名系統+拆解動詞、D 對比/選擇困境
額外加分：+8 雙段式結構、+5 內容相關度高、+3 知名系統名、+2 長度 35-50 字
扣分雷區（每踩一個 -15 分）：太學術、沒具體系統、純技術規格、標題太短

以 JSON 格式回傳：
{ "titles": ["標題1", ..., "標題10"], "bestIndex": 1, "bestTitle": "完整標題", "reason": "選擇理由" }

bestIndex 為 1-based 索引。`;
}

function buildSysdesignDescriptionPrompt(summary: string): string {
  return `根據以下「系統設計懶懶學」內容生成 Podcast 描述，列出本集系統設計重點。

內容摘要：
${summary}

格式：
開頭段落（用 1-2 句帶出本集要拆解的系統及其規模）🏗️

接下來用 💡 和 👉 列出 3-5 個重點（可以是架構決策、設計模式、擴展策略等）：
💡 一句話描述這個架構重點
👉 為什麼這個設計決策重要

⚠️ 注意：💡 後面直接寫一句完整的話
❌ 錯誤：💡 Consistent Hashing：分散式系統的核心技術
✅ 正確：💡 Uber 用 Consistent Hashing 解決了百萬司機的即時配對問題

要求：200-400字、技術含量但口語化、不含外部連結（參考資料會由系統自動附加）

以 JSON 格式回傳：
{ "description": "完整描述" }`;
}


function buildDescriptionPrompt(summary: string): string {
  return `根據以下內容生成 Podcast 描述，列出 5 個重點亮點。

內容摘要：
${summary}

格式：
開頭段落（用 1-2 句吸引人的話帶出本集主題）🚀

接下來用 💡 和 👉 列出 5 個重點（可以是工具亮點、應用場景或重要觀點）：
💡 一句話描述這個亮點
👉 應用場景和價值

⚠️ 注意：💡 後面直接寫一句完整的話，不要用「工具名稱：」當開頭標題。
❌ 錯誤：💡 Claude Code：你的程式碼助手學會排程任務了！
❌ 錯誤：💡 向量資料庫：AI 的長期記憶海馬迴！
✅ 正確：💡「Claude Code」學會排程任務，變成你 24 小時不打烊的專屬工程師！
✅ 正確：💡「向量資料庫」讓 AI 擁有長期記憶，搜尋精準度直接飆升！

要求：200-400字、輕鬆有趣、不含外部連結

以 JSON 格式回傳：
{ "description": "完整描述" }`;
}

function buildRobotDescriptionPrompt(summary: string): string {
  return `根據以下「機器人觀察週報」內容生成 Podcast 描述，列出 5 個重點亮點。

內容摘要：
${summary}

格式：
開頭段落（點出本週機器人圈重大趨勢）🤖

接下來用 💡 和 👉 列出 5 個重點（可以是機器人、公司、技術突破或應用場景）：
💡 一句話描述這個亮點
👉 產業影響或未來展望

⚠️ 注意：💡 後面直接寫一句完整的話，不要用「工具名稱：」當開頭標題。
❌ 錯誤：💡 Tesla Optimus：人形機器人取得重大突破！
✅ 正確：💡「Tesla Optimus」走出工廠，首度在真實環境完成搬運任務！

要求：200-400字、輕鬆但有科技觀點、不含外部連結

以 JSON 格式回傳：
{ "description": "完整描述" }`;
}

function buildWeeklyDescriptionPrompt(summary: string): string {
  return `根據以下《AI懶人精選週報》內容生成 Podcast 描述，列出 5 個重點亮點。

內容摘要：
${summary}

格式：
開頭段落（點出本週 AI 工具圈最值得關注的趨勢）🚀

接下來用 💡 和 👉 列出 5 個重點（可以是工具亮點、應用場景或重要觀點）：
💡 一句話描述這個亮點
👉 應用場景和價值

⚠️ 注意：💡 後面直接寫一句完整的話，不要用「工具名稱：」當開頭標題。
❌ 錯誤：💡 Claude Code：你的程式碼助手學會排程任務了！
❌ 錯誤：💡 向量資料庫：AI 的長期記憶海馬迴！
✅ 正確：💡「Claude Code」學會排程任務，變成你 24 小時不打烊的專屬工程師！
✅ 正確：💡「向量資料庫」讓 AI 擁有長期記憶，搜尋精準度直接飆升！

要求：200-400字、輕鬆有趣、帶有「一週回顧」的語氣、不含外部連結

以 JSON 格式回傳：
{ "description": "完整描述" }`;
}

function buildTagsPrompt(summary: string, title: string): string {
  return `你是 YouTube SEO 專家。根據以下 Podcast 內容和標題，生成 YouTube tags。

標題：${title}
內容摘要：${summary}

要求：
1. 20-30 個 tags
2. 包含品牌 tag（AI懶人報）、工具名稱、技術關鍵字
3. 混合繁體中文 + English
4. 從廣泛到具體排序

以 JSON 格式回傳：
{ "tags": ["tag1", "tag2", ...] }`;
}

// ── Reusable Title Regeneration ──

export async function regenerateTitles(
  segmentType: string,
  scriptContent: string,
  episodeId?: number,
): Promise<{ candidateTitles: string[]; selectedTitle: string }> {
  const llm = getLLMService();
  const isRobot = segmentType === 'robot';
  const isWeekly = segmentType === 'weekly';
  const isSysdesign = segmentType === 'sysdesign';

  // Try to use saved summary, otherwise generate one
  const summary = await getOrCreateSummary(scriptContent, segmentType, episodeId);

  const titlePrompt = isSysdesign ? buildSysdesignTitlePrompt(summary)
    : isRobot ? buildRobotTitlePrompt(summary)
    : isWeekly ? buildWeeklyTitlePrompt(summary)
    : buildTitlePrompt(summary);

  const titlesResult = await llm.generateJSON<{ titles: string[]; bestIndex: number; bestTitle: string }>(
    titlePrompt,
    'title_gen',
    { episodeId, maxTokens: 2048, temperature: 0.7 }
  );

  const candidateTitles = titlesResult.success && titlesResult.data?.titles
    ? titlesResult.data.titles
    : getFallbackTitles();

  let selectedTitle = candidateTitles[0];
  if (titlesResult.success && titlesResult.data?.bestIndex) {
    const idx = (titlesResult.data.bestIndex || 1) - 1;
    if (idx >= 0 && idx < candidateTitles.length) {
      selectedTitle = candidateTitles[idx];
    }
  }

  return { candidateTitles, selectedTitle };
}

// ── Reusable Description Regeneration ──

export async function regenerateDescription(
  segmentType: string,
  scriptContent: string,
  episodeId?: number,
): Promise<string> {
  const llm = getLLMService();
  const isRobot = segmentType === 'robot';
  const isWeekly = segmentType === 'weekly';
  const isSysdesign = segmentType === 'sysdesign';

  // Try to use saved summary, otherwise generate one
  const summary = await getOrCreateSummary(scriptContent, segmentType, episodeId);

  const descPrompt = isSysdesign ? buildSysdesignDescriptionPrompt(summary)
    : isRobot ? buildRobotDescriptionPrompt(summary)
    : isWeekly ? buildWeeklyDescriptionPrompt(summary)
    : buildDescriptionPrompt(summary);

  const descResult = await llm.generateJSON<{ description: string }>(
    descPrompt,
    'description_gen',
    { episodeId, maxTokens: 1024, temperature: 0.7 }
  );

  if (descResult.success && descResult.data?.description) {
    return descResult.data.description
      .replace(/.*drive\.google\.com.*\n?/g, '')
      .replace(/.*點擊這裡收聯.*\n?/g, '')
      .trim();
  }

  return getFallbackDescription();
}

// ── Summary Helper ──

async function getOrCreateSummary(
  scriptContent: string,
  segmentType: string,
  episodeId?: number,
): Promise<string> {
  if (episodeId) {
    try {
      const db = getDb();
      const row = db.prepare('SELECT script_summary FROM episodes WHERE id = ?')
        .get(episodeId) as { script_summary: string | null } | undefined;
      if (row?.script_summary) return row.script_summary;
    } catch { /* non-critical */ }
  }

  const summary = await summarizeScript(scriptContent, segmentType, episodeId);

  if (episodeId) {
    try {
      const db = getDb();
      db.prepare('UPDATE episodes SET script_summary = ? WHERE id = ?')
        .run(summary, episodeId);
    } catch { /* non-critical */ }
  }

  return summary;
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
