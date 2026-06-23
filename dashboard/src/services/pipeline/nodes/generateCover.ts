/**
 * Stage 7: Generate Cover Image.
 *
 * 1. IG Scenario Agent generates a scene description (n8n 插畫情境描述產生Agent)
 * 2. Build 湯懶懶 image prompt with scenario (n8n exact format)
 * 3. kie.ai generates image with 5 reference images
 * 4. Upload to Cloudinary
 */

import { getLLMService } from '@/services/llmService';
import { generateCoverImage, downloadImage } from '@/services/imageService';
import { uploadToCloudinary } from '@/services/cloudinary';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import {
  detectHoliday,
  getHolidayByKey,
  buildScenarioHolidayDirective,
  buildImageHolidayDirective,
  type HolidayMatch,
} from '@/services/holidayContext';
import path from 'path';
import type { PipelineState } from '../state';

/**
 * Options for cover generation.
 * holidayOverride: undefined → auto-detect by publish date; 'none' → force plain
 * (no holiday); a holiday key → force that holiday.
 * contextText / contextImageUrl: optional user-supplied context (news/topic) that
 * augments the episode summary for the scenario. When either is present, holiday
 * theming is skipped (context wins).
 */
export interface CoverOptions {
  holidayOverride?: string;
  contextText?: string;
  contextImageUrl?: string;
}

interface ContextInput {
  text: string;        // combined user text + vision-extracted summary
  referenceImageUrl?: string; // set only when the screenshot should also be a visual reference
}

const log = createChildLogger('pipeline:cover');

const OUTPUT_DIR = path.join(process.cwd(), '..', 'temp', 'covers');
const SCENARIO_MODEL = 'google/gemini-3.1-flash-lite-preview';
const EXTRACTION_MODEL = 'google/gemini-3.1-flash-lite-preview';
const VISION_MODEL = 'google/gemini-3.1-flash-lite-preview'; // vision-capable (verified); reads context screenshots

// n8n 5 reference images for kie.ai
const REFERENCE_IMAGES = [
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1757600697/pfrlq5d5d5vtxqljgiht.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1758471943/xi6cwkuwjenrw7shrqsj.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1758557835/n2qgte9m27xyimmxr56t.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1756213768/tzfsghgnxtilslfp6gi0.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1750843184/nwap9q7xy9oc7a7qjkw4.png',
];

export async function generateCover(state: PipelineState, opts: CoverOptions = {}): Promise<Partial<PipelineState>> {
  log.info({ episodeId: state.episodeId }, 'Generating cover image');

  if (!process.env.KIE_AI_API_KEY && !process.env.FAL_KEY) {
    log.warn('No image generation key set (KIE_AI_API_KEY or FAL_KEY), skipping cover generation');
    return { coverPath: '', coverUrl: '', igScenario: '', igHoliday: '', status: 'tts' };
  }

  // Resolve user-supplied context (news/topic). When present, it augments the
  // episode summary and holiday theming is skipped (context wins).
  const hasContext = !!(opts.contextText?.trim() || opts.contextImageUrl);
  let context: ContextInput | null = null;
  if (hasContext) {
    try {
      context = await buildContextInput(opts, state.episodeId);
      log.info({ hasImage: !!opts.contextImageUrl, asReference: !!context.referenceImageUrl }, 'User context resolved');
    } catch (error) {
      log.warn({ error: (error as Error).message }, 'Context resolution failed, proceeding with text context only');
      context = { text: opts.contextText?.trim() || '' };
    }
  }

  // Resolve holiday context: skipped entirely when the user supplied context.
  let holiday: HolidayMatch | null = null;
  if (!hasContext) {
    try {
      if (opts.holidayOverride === 'none') {
        holiday = null;
      } else if (opts.holidayOverride) {
        holiday = getHolidayByKey(opts.holidayOverride);
        if (!holiday) log.warn({ holidayOverride: opts.holidayOverride }, 'Unknown holiday override key, ignoring');
      } else {
        holiday = detectHoliday();
      }
    } catch (error) {
      // Never let holiday detection break cover generation.
      log.warn({ error: (error as Error).message }, 'Holiday detection failed, proceeding without holiday theme');
      holiday = null;
    }
  }
  if (holiday) log.info({ holiday: holiday.key, tier: holiday.tier }, 'Holiday theme applied to cover');
  // Context-driven covers clear any prior holiday tag.
  const holidayKey = holiday?.key ?? '';

  // Step 1: IG Scenario Agent — generate scene description
  let scenario = '';
  try {
    scenario = await generateScenario(state, holiday, context);
    log.info({ scenario: scenario.slice(0, 100) }, 'Scenario generated');
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Scenario generation failed');
    return { coverPath: '', coverUrl: '', igScenario: '', igHoliday: holidayKey, coverError: (error as Error).message, status: 'tts' };
  }

  // Step 2: Build image prompt
  const isRobot = state.segmentType === 'robot';
  const isSysdesign = state.segmentType === 'sysdesign';
  const imagePrompt = buildImagePrompt(scenario, isRobot, isSysdesign, holiday);

  // When the user's screenshot should be echoed visually, prepend it (highest weight).
  const referenceImages = context?.referenceImageUrl
    ? [context.referenceImageUrl, ...REFERENCE_IMAGES]
    : REFERENCE_IMAGES;

  // Step 3: kie.ai image generation with retry (max 3 attempts, 15s apart)
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 15_000;
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const coverStartMs = Date.now();
      const { url: imageUrl, provider } = await generateCoverImage(imagePrompt, {
        model: 'gpt-image-2-image-to-image',
        aspectRatio: '1:1',
        resolution: '1K',
        referenceImages,
      });

      // Log cost
      try {
        const db = getDb();
        const costKey = provider === 'falai' ? 'falai_gpt_image_2_high_usd' : 'kieai_gpt_image_2_1k_usd';
        const costDefault = provider === 'falai' ? '0.08' : '0.03';
        const costUsd = parseFloat(
          (db.prepare('SELECT value FROM settings WHERE key = ?').get(costKey) as { value: string })?.value || costDefault
        );
        const serviceName = provider === 'falai' ? 'falai_cover' : 'kieai_cover';
        db.prepare(
          'INSERT INTO service_costs (episode_id, episode_number, service, model, units, cost_usd, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(state.episodeId, state.episodeNumber ?? null, serviceName, 'gpt-image-2', 1, costUsd, Date.now() - coverStartMs);
        log.info({ costUsd, provider }, 'Cover image cost logged');
      } catch (err) {
        log.warn({ error: (err as Error).message }, 'Failed to log cover cost');
      }

      // Download to local
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
      const coverFilename = `${dateStr}_${timeStr}_${state.segmentType}_cover.png`;
      const localPath = path.join(OUTPUT_DIR, coverFilename);
      await downloadImage(imageUrl, localPath);

      // Upload to Cloudinary
      let publicUrl = imageUrl;
      if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_UPLOAD_PRESET) {
        publicUrl = await uploadToCloudinary(localPath, coverFilename);
      }

      // Append to cover_candidates
      try {
        const db2 = getDb();
        const row = db2.prepare('SELECT cover_candidates FROM episodes WHERE id = ?').get(state.episodeId) as { cover_candidates: string | null } | undefined;
        const candidates: { path: string; url: string; createdAt: string; source: string }[] = row?.cover_candidates ? JSON.parse(row.cover_candidates) : [];
        candidates.push({ path: localPath, url: publicUrl, createdAt: new Date().toISOString(), source: 'generated' });
        db2.prepare('UPDATE episodes SET cover_candidates = ?, ig_holiday = ? WHERE id = ?').run(JSON.stringify(candidates), holidayKey, state.episodeId);
      } catch (err) {
        log.warn({ error: (err as Error).message }, 'Failed to update cover_candidates');
      }

      log.info({ coverPath: localPath, coverUrl: publicUrl, attempt, holiday: holidayKey || null }, 'Cover image ready');
      return { coverPath: localPath, coverUrl: publicUrl, igScenario: scenario, igHoliday: holidayKey, coverError: '', status: 'tts' };
    } catch (error) {
      lastError = (error as Error).message;
      log.warn({ attempt, maxAttempts: MAX_ATTEMPTS, error: lastError }, 'Cover generation attempt failed');
      if (attempt < MAX_ATTEMPTS) {
        log.info({ delayMs: RETRY_DELAY_MS }, 'Retrying cover generation...');
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  log.error({ error: lastError, attempts: MAX_ATTEMPTS }, 'Cover generation failed after all retries');
  return { coverPath: '', coverUrl: '', igScenario: scenario, igHoliday: holidayKey, coverError: lastError, status: 'tts' };
}

// Step 1: Extract scenario candidates from podcast script summary
async function extractScenarioCandidates(
  scriptSummary: string,
  segmentType: string,
  episodeId: number,
): Promise<string[]> {
  const llm = getLLMService();
  const isSysdesign = segmentType === 'sysdesign';

  const sysdesignExtra = isSysdesign
    ? `\n🏗️ 系統設計特別要求：
- 場景要帶有系統設計的視覺元素（方塊、箭頭、流程圖、連線圖等）
- 但要用日常生活的方式呈現，不要正經八百（例如「用奶茶店排隊比喻 message queue」）
- 必須包含今天拆解的系統/產品名稱`
    : '';

  const prompt = `你是一位 IG 插畫情境企劃師。請從以下 Podcast 內容摘要中，找出 3 個最適合做成可愛插畫的場景。

🎯 選場景的標準：
- 要有具體畫面感（能讓畫師直接畫出來的場景）
- 要好笑、幽默、可愛、或讓人會心一笑
- 要跟 Podcast 內容直接相關（不要自己編，要從摘要內容中提取）
- 要能讓一隻懶懶的樹懶角色自然融入${sysdesignExtra}

📝 Podcast 內容摘要：
${scriptSummary}

請輸出 3 個場景候選，每個 1～2 句，用數字編號。只輸出場景描述，不要其他文字。

範例格式：
1. Netflix 的 CDN 把影片分散到全球節點，就像把零食藏在家裡每個角落，隨手一伸就有東西吃
2. Rate Limiter 限制每秒請求數量，就像奶茶店的號碼牌，再急也要乖乖排隊
3. Load Balancer 把流量分散到不同伺服器，就像把功課分給不同同學抄`;

  const result = await llm.call({
    stage: 'ig_scenario_extract',
    episodeId,
    messages: [{ role: 'user', content: prompt }],
    options: {
      preferredModel: EXTRACTION_MODEL,
      maxTokens: 512,
      temperature: 0.7,
    },
  });

  if (result.success && result.content) {
    // Parse numbered list into array
    const candidates = result.content
      .split(/\n/)
      .map(line => line.replace(/^\d+\.\s*/, '').trim())
      .filter(line => line.length > 10);
    if (candidates.length > 0) return candidates;
  }

  return [];
}

// Resolve user-supplied context into scenario text (+ optional visual reference).
async function buildContextInput(opts: CoverOptions, episodeId: number): Promise<ContextInput> {
  const userText = opts.contextText?.trim() || '';
  if (!opts.contextImageUrl) {
    return { text: userText };
  }
  // Vision LLM reads the screenshot and judges how it should be used.
  const vision = await interpretContextImage(opts.contextImageUrl, userText, episodeId);
  const combined = [userText, vision.summary].filter(Boolean).join('\n\n');
  return {
    text: combined,
    referenceImageUrl: vision.useAsVisualReference ? opts.contextImageUrl : undefined,
  };
}

// Vision call: read a context screenshot → summary + whether to echo it visually.
async function interpretContextImage(
  imageUrl: string,
  userText: string,
  episodeId: number,
): Promise<{ summary: string; useAsVisualReference: boolean }> {
  const llm = getLLMService();
  const prompt = `你正在協助設計一張 Instagram 插畫封面。使用者附上一張截圖作為「靈感/情境素材」。
請判讀這張截圖，並只輸出以下 JSON：
{
  "summary": "用 2～4 句繁體中文描述截圖的內容重點（新聞標題、人物、梗或畫面），作為插畫情境素材",
  "useAsVisualReference": true 或 false
}
判斷 useAsVisualReference 的標準：
- true：截圖本身是值得在插畫中「視覺重現或致敬」的畫面（梗圖、產品 UI、特定角色、特殊構圖）
- false：截圖只是純文字新聞/文章，只需擷取其資訊作為情境素材${userText ? `\n\n使用者補充說明：${userText}` : ''}`;

  const result = await llm.call({
    stage: 'ig_context_vision',
    episodeId,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    options: { preferredModel: VISION_MODEL, maxTokens: 512, temperature: 0.4 },
  });

  if (result.success && result.content) {
    try {
      const match = result.content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return {
          summary: typeof parsed.summary === 'string' ? parsed.summary : '',
          useAsVisualReference: parsed.useAsVisualReference === true,
        };
      }
    } catch { /* fall through to default */ }
  }
  return { summary: '', useAsVisualReference: false };
}

// Step 2: Design visual scene from scenario candidates
async function generateScenario(state: PipelineState, holiday: HolidayMatch | null = null, context: ContextInput | null = null): Promise<string> {
  const llm = getLLMService();
  const isRobot = state.segmentType === 'robot';
  const isSysdesign = state.segmentType === 'sysdesign';
  const topVideoTitle = state.selectedVideos?.[0]?.title || state.selectedTitle || (isSysdesign ? 'System Design' : isRobot ? 'Robotics' : 'AI tools');

  // Extract scenario candidates from script summary if available
  let scenarioCandidates: string[] = [];
  if (state.scriptSummary) {
    scenarioCandidates = await extractScenarioCandidates(
      state.scriptSummary, state.segmentType, state.episodeId,
    );
    log.info({ count: scenarioCandidates.length }, 'Scenario candidates extracted');
  }

  // Build the topic section: use candidates if available, fallback to video title
  const topicSection = scenarioCandidates.length > 0
    ? `🔻 從 Podcast 內容提取的場景候選（請從中選出最適合做成插畫的一個）：
${scenarioCandidates.map((c, i) => `${i + 1}. ${c}`).join('\n')}

📌 參考主題：「${topVideoTitle}」`
    : `🔻 今日主題（YouTube Trending）：
「${topVideoTitle}」`;

  const prompt = `你是一位專門為 Instagram 插畫創作撰寫日常情境的 療癒系小劇場設計師。
你的任務是根據提供的 Podcast 場景素材，創作一則畫面感強、貼近日常又帶點幽默感的樹懶角色情境描述，提供給 AI 圖像生成 Agent 作為插圖靈感。

🎯 請遵循以下風格與規則：

🦥 角色設定：
主角「湯懶懶」是一隻慵懶療癒又有點聰明愛運動的樹懶，在歐洲唸書，自稱「懶人教主」，擅長用 AI 工具偷懶工作學習，日常充滿沙發、手搖飲與對抗人生焦慮的智慧，喜歡抱怨生活厭世，卻也很擁抱生活的點滴，喜歡打網球，騎公路車。

💬 語氣風格：
語調輕鬆、口語、有點廢又可愛，像是 IG 小日記或貼圖旁邊會配的對白。句子短、具畫面感。

🛋️ 情境類型（背景場景建議）：
請從以下類型中選擇合適場景與標籤，設計出有畫面感的小劇情：

💼 上班救援
💸 懶人致富
🧘‍♀️ 慢活生活
❤️ 社交戀愛
😵‍💫 廢物日常

推薦背景場景（自行評估擇一）如：咖啡廳、機場、校園、健身房、網球場、海邊bar、超市、飛機上、教堂前、火車上、公車、公園、電車、辦公桌前、公司茶水間、床上、超商、開車中等等上班族或創業家或個人工作者可能會有的日常行程點。

📦 可用畫面元素（視情境搭配, 但切記畫面不可過於混亂過多元素，至多插入四個元素）：
科技類：筆電、平板、手機、耳機、機器手臂、AI 視窗
${isSysdesign ? `系統架構類（請依據場景候選推導具體元素）：
- 白板上潦草的方塊箭頭圖、便利貼牆、咖啡杯旁的架構草稿紙
- 跟主題產品相關的生活化道具（如 Netflix → 串流播放畫面、爆米花）
重點：道具要生活化、可愛，避免冷冰冰的伺服器機櫃或抽象符號` : ''}
日常療癒類：棉被、奶茶、冰箱、垃圾桶、植物、絨毛玩偶、小貓小狗

工作類：白板、簡報、打卡機、便當盒、報表圖卡

社群互動類：對話泡泡、任務提示條、App UI片段

運動類：慢跑，公路車，網球，健身

🧠 任務指令（請開始創作）：
${scenarioCandidates.length > 0
    ? '請從下方場景候選中，選出最有畫面感、最適合做成可愛插畫的一個，然後設計湯懶懶在這個場景中的視覺描述。'
    : '請根據下方主題，創作出一段符合角色與畫風的插畫情境。'}

包含以下要素：
- 一個具體的生活場景（湯懶懶在做什麼、在哪裡）
- 湯懶懶用他的懶人方式融入這個場景的動作/反應
- 一個有趣、可愛或令人會心一笑的小互動細節
- 🏷️ 今天拆解的系統或產品名稱（1～2 個，用於畫面中以簡化 Logo 貼紙形式出現）
  ⚠️ 只放主題分析的產品，不放講者背景順帶提到的公司

⏱ 長度限制：2～4 句，簡短扼要但畫面感強

${topicSection}${holiday ? buildScenarioHolidayDirective(holiday) : ''}${context?.text ? buildScenarioContextDirective(context.text) : ''}`;

  const result = await llm.call({
    stage: 'ig_scenario',
    episodeId: state.episodeId,
    messages: [{ role: 'user', content: prompt }],
    options: {
      preferredModel: SCENARIO_MODEL,
      maxTokens: 512,
      temperature: 0.8,
    },
  });

  return result.content || '湯懶懶趴在沙發上，筆電螢幕亮著 AI 工具，手裡握著半杯珍奶，嘴角微微上揚地說：「讓 AI 加班就好，我負責躺。」';
}

// Directive injected when the user supplies news/topic context (augments the summary).
function buildScenarioContextDirective(contextText: string): string {
  return `\n\n📰 使用者提供的時事／情境素材（請務必整合進情境，並與 Podcast 標題/內容結合）：
${contextText}

請以這則素材作為這張圖的主軸，做出貼近「近期熱門話題或新聞」、且讓人會心一笑的梗，再自然帶到 Podcast 主題。素材與 Podcast 內容要並存呼應，不要只剩其中一邊。`;
}

// n8n exact image prompt template for kie.ai
function buildImagePrompt(scenario: string, isRobot: boolean = false, isSysdesign: boolean = false, holiday: HolidayMatch | null = null): string {
  const styleNote = isSysdesign
    ? '可愛療癒貼圖風 + 廢感幽默 + 跟主題相關的生活化小道具'
    : isRobot
    ? '可愛療癒 + 廢感幽默 + 小科技感 + 未來機器人感'
    : '可愛療癒 + 廢感幽默 + 小科技感';
  return `請繪製一張主角為「湯懶懶 Mr. Sloth」的 Instagram 插畫風格圖像，構圖為正方形（1:1）。

---

🧠 主角人設：
湯懶懶是一名表面看起來懶，但其實很懂效率的科技上班族。他擅長把所有瑣事交給 AI 處理，自己只專注在喝奶茶、看Netflix、睡覺、耍廢、運動、美食與戀愛。

---

🎯 插圖主題（請僅選擇單一明確情境進行創作）：
${scenario}
請盡可能聚焦單一畫面重點

---

🎨 插畫風格說明：
- 插畫風格：${styleNote}
- 色調：柔和溫暖（奶茶棕、柔藍、杏橘、抹茶綠）
- 角色比例：Q 版大頭身（頭身比約 1:1.5），圓潤線條，四肢短小可愛
- 主角表情建議：放鬆、自信、無所謂、微微奸笑、睜半隻眼、呆萌無辜、嘴角上揚、張嘴大笑、帶點「我才是最聰明的那個」感 （選擇與主題契合的）
- 肢體動態：鼓勵有動作感的姿勢（歪頭、打哈欠、趴著、揮手、翹腳、單手撐頭），避免正面直立呆站
請避免傳統「笑開懷」或「無表情」風格，表情要具有角色特色、能引起觀眾注意與共鳴。

---

📐 構圖建議：
- 湯懶懶應為畫面主角，佔據視覺焦點（畫面不要過滿）
- **只需出現 1～3 個重點配件**
- 可有 1 個小浮窗或對話泡泡（用台灣繁體中文顯示文字，勿使用英文，除非是公司or產品名稱或專有名詞用法）
- 🏷️ 如果情境中提到「今天拆解的系統/產品」（如 Netflix、Uber 等），請在畫面角落或道具上加入該品牌的簡化 Q 版 Logo 貼紙，風格要融入整體插畫（圓角、柔色、貼紙感），不要直接放正式 Logo。注意：只放主題分析的產品，不要放講者背景中順帶提到的公司

---

💡 圖像整體要求：
這張圖需要：
✔ 主題明確（1 個生活情境）
✔ 畫面簡潔但有故事性
✔ 有社群共鳴（例如：「這不就是我週一早上嗎」的感覺）
✔ 有療癒感 + 效率感 + 微反諷幽默

---

備註：可讓 AI 以小對話窗、螢幕通知、手機提示方式出現。請避免一次塞太多道具或角色，保持畫面聚焦。
⚠️ 重要：畫面裡文字絕對要使用台灣繁體中文，除非是公司or產品名稱或專有名詞用法
⚠️ 重要：文字絕對不能太小以免生成亂碼雜訊${holiday ? buildImageHolidayDirective(holiday) : ''}`;
}
