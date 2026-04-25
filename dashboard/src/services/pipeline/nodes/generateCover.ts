/**
 * Stage 7: Generate Cover Image.
 *
 * 1. IG Scenario Agent generates a scene description (n8n 插畫情境描述產生Agent)
 * 2. Build 湯懶懶 image prompt with scenario (n8n exact format)
 * 3. kie.ai generates image with 5 reference images
 * 4. Upload to Cloudinary
 */

import { getLLMService } from '@/services/llmService';
import { generateCoverImage, downloadImage } from '@/services/kieai';
import { uploadToCloudinary } from '@/services/cloudinary';
import { createChildLogger } from '@/lib/logger';
import path from 'path';
import type { PipelineState } from '../state';

const log = createChildLogger('pipeline:cover');

const OUTPUT_DIR = path.join(process.cwd(), '..', 'temp', 'covers');
const SCENARIO_MODEL = 'google/gemini-3-flash-preview';

// n8n 5 reference images for kie.ai
const REFERENCE_IMAGES = [
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1757600697/pfrlq5d5d5vtxqljgiht.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1758471943/xi6cwkuwjenrw7shrqsj.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1758557835/n2qgte9m27xyimmxr56t.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1756213768/tzfsghgnxtilslfp6gi0.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1750843184/nwap9q7xy9oc7a7qjkw4.png',
];

export async function generateCover(state: PipelineState): Promise<Partial<PipelineState>> {
  log.info({ episodeNumber: state.episodeNumber }, 'Generating cover image');

  if (!process.env.KIE_AI_API_KEY) {
    log.warn('KIE_AI_API_KEY not set, skipping cover generation');
    return { coverPath: '', coverUrl: '', igScenario: '', status: 'tts' };
  }

  try {
    // Step 1: IG Scenario Agent — generate scene description
    const scenario = await generateScenario(state);
    log.info({ scenario: scenario.slice(0, 100) }, 'Scenario generated');

    // Step 2: Build full 湯懶懶 image prompt with scenario
    const isRobot = state.segmentType === 'robot';
    const imagePrompt = buildImagePrompt(scenario, isRobot);

    // Step 3: kie.ai generates image with reference images
    const imageUrl = await generateCoverImage(imagePrompt, {
      model: 'nano-banana-pro',
      aspectRatio: '1:1',
      resolution: '2K',
      referenceImages: REFERENCE_IMAGES,
    });

    // Step 4: Download to local
    const localPath = path.join(OUTPUT_DIR, `ep${state.episodeNumber}_cover.png`);
    await downloadImage(imageUrl, localPath);

    // Step 5: Upload to Cloudinary for public URL
    let publicUrl = imageUrl;
    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_UPLOAD_PRESET) {
      publicUrl = await uploadToCloudinary(localPath, `ep${state.episodeNumber}_cover.png`);
    }

    log.info({ coverPath: localPath, coverUrl: publicUrl }, 'Cover image ready');
    return { coverPath: localPath, coverUrl: publicUrl, igScenario: scenario, status: 'tts' };
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Cover generation failed, continuing without cover');
    return { coverPath: '', coverUrl: '', igScenario: '', status: 'tts' };
  }
}

// n8n exact prompt for 插畫情境描述產生Agent
async function generateScenario(state: PipelineState): Promise<string> {
  const llm = getLLMService();
  const isRobot = state.segmentType === 'robot';
  const topVideoTitle = state.selectedVideos?.[0]?.title || state.selectedTitle || (isRobot ? 'Robotics' : 'AI tools');

  const prompt = `你是一位專門為 Instagram 插畫創作撰寫日常情境的 療癒系小劇場設計師。
你的任務是每天根據當天最熱門的 YouTube 或 Podcast 主題，創作一則 畫面感強、貼近日常又帶點幽默感的樹懶角色情境描述，提供給 AI 圖像生成 Agent 作為插圖靈感。
請巧妙地將熱門主題轉化為角色生活中的一段小劇情，加入代表性的畫面元素，讓插畫更有故事性與趣味感。

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

日常療癒類：棉被、奶茶、冰箱、垃圾桶、植物、絨毛玩偶、小貓小狗

工作類：白板、簡報、打卡機、便當盒、報表圖卡

社群互動類：對話泡泡、任務提示條、App UI片段

運動類：慢跑，公路車，網球，健身

🧠 任務指令（請開始創作）：
請根據下方主題，創作出一段符合角色與畫風的插畫情境，包含以下三要素：

一個具體的生活場景

AI 工具在其中的實際應用情節

一個有趣、可愛或令人會心一笑的小互動細節

⏱ 長度限制：1～3 句，簡短扼要但畫面感強

🔻 今日主題（YouTube Trending）：
「${topVideoTitle}」`;

  const result = await llm.call({
    stage: 'ig_scenario',
    episodeNumber: state.episodeNumber,
    messages: [{ role: 'user', content: prompt }],
    options: {
      preferredModel: SCENARIO_MODEL,
      maxTokens: 512,
      temperature: 0.8,
    },
  });

  return result.content || '湯懶懶趴在沙發上，筆電螢幕亮著 AI 工具，手裡握著半杯珍奶，嘴角微微上揚地說：「讓 AI 加班就好，我負責躺。」';
}

// n8n exact image prompt template for kie.ai
function buildImagePrompt(scenario: string, isRobot: boolean = false): string {
  const styleNote = isRobot
    ? '可愛療癒 + 廢感幽默 + 小科技感 + 未來機器人感'
    : '可愛療癒 + 廢感幽默 + 小科技感';
  return `請繪製一張主角為「湯懶懶 Mr. Sloth」的 Instagram 插畫風格圖像，構圖為正方形（1:1）。---🧠 主角人設：湯懶懶是一名表面看起來懶，但其實很懂效率的科技上班族。他擅長把所有瑣事交給 AI 處理，自己只專注在喝奶茶、看Netflix、睡覺、耍廢、運動、美食與戀愛。他是「懶教教主」，自稱「懶得剛剛好」生活哲學實踐者，口頭禪：「你動手了？你太沒效率了。」---🎯 插圖主題（請僅選擇單一明確情境進行創作）：${scenario} 請盡可能聚焦單一畫面重點 ---🎨 插畫風格說明：- 插畫風格：${styleNote}- 色調：柔和溫暖（奶茶棕、柔藍、杏橘、抹茶綠）- 主角表情建議：放鬆、自信、無所謂、微微奸笑、睜半隻眼、呆萌無辜、嘴角上揚、張嘴大笑、帶點「我才是最聰明的那個」感 （選擇與主題契合的）請避免傳統「笑開懷」或「無表情」風格，表情要具有角色特色、能引起觀眾注意與共鳴。---📐 構圖建議：- 湯懶懶應為畫面主角，佔據視覺焦點（畫面不要過滿）- **只需出現 1～3 個重點配件**- 可有 1 個小浮窗或對話泡泡（用台灣繁體中文顯示文字，勿使用英文，除非是公司or產品名稱或專有名詞用法）---💡 圖像整體要求：這張圖需要：✔ 主題明確（1 個生活情境）✔ 畫面簡潔但有故事性✔ 有社群共鳴（例如：「這不就是我週一早上嗎」的感覺）✔ 有療癒感 + 效率感 + 微反諷幽默---備註：可讓 AI 以小對話窗、螢幕通知、手機提示方式出現。請避免一次塞太多道具或腳色，保持畫面聚焦。 ⚠️ 重要： 畫面裡文字絕對要使用台灣繁體中文，除非是公司or產品名稱或專有名詞用法 ⚠️ 重要：文字絕對太能小以免生成亂碼雜訊`;
}
