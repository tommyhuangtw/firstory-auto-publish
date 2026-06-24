/**
 * 湯懶懶 in-article illustration generator for Substack drafts.
 *
 * Given a short scene brief, builds a full character prompt, generates a landscape
 * editorial illustration via kie.ai (image-to-image, anchored on the canonical
 * 湯懶懶 reference images so the character stays consistent), and uploads the result
 * to Cloudinary for a stable public URL (Substack imports images by fetching the URL).
 */

import { generateCoverImage } from '@/services/imageService';
import { uploadToCloudinary } from '@/services/cloudinary';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('slothIllustrationService');

// Canonical 湯懶懶 reference images (same set the IG cover generator uses).
const REFERENCE_IMAGES = [
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1757600697/pfrlq5d5d5vtxqljgiht.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1758471943/xi6cwkuwjenrw7shrqsj.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1758557835/n2qgte9m27xyimmxr56t.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1756213768/tzfsghgnxtilslfp6gi0.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1750843184/nwap9q7xy9oc7a7qjkw4.png',
];

const CHARACTER = `「湯懶懶 Mr. Sloth」是 AI 懶人報的品牌角色——一隻聰明、從容、專業的樹懶。請嚴格參考提供的參考圖，保持同一個角色的外型長相，並呈現專業、有自信的形象。`;

const COMPOSITION = `構圖重點（很重要）：畫面「主體」是這段內容要講的「概念本身」，用編輯插畫把那個概念／隱喻視覺化。湯懶懶只是帶有品牌風格的「配角點綴」——比例不用大、不要佔滿畫面、不一定在正中央，自然融入畫面一角即可。重點是內容，不是樹懶。`;

const PROFESSIONAL = `調性必須專業可信（這是放在 Substack 專業文章裡的插圖）：
- 不要珍珠奶茶、懶骨頭沙發、躺平、打瞌睡、擺爛等「耍廢」道具或姿態。
- 不必侷限在辦公室或房間；場景由「要表達的概念」決定，可以是抽象、概念化的視覺隱喻。
- 畫面文字要專業、有洞見、點出重點，不要寫「我負責耍廢」「躺平」「relax」這類自嘲的話。`;

const STYLE = `風格：溫暖但專業的編輯插畫感、柔和暖色調（奶油白、焦糖、暖黃），乾淨簡潔不雜亂、留適度空白。橫式構圖。
受眾是台灣人：畫面中所有文字一律用「繁體中文（台灣用語）」，只有本來就是英文的專有名詞／技術術語（AI、TDD、API、Claude、ChatGPT 等）才保留英文。文字要少、字級大、清楚易讀。`;

/**
 * Generate one in-article 湯懶懶 illustration for a scene brief.
 * Returns a stable Cloudinary URL. Throws on failure (caller decides fallback).
 */
export async function generateSlothIllustration(brief: string): Promise<string> {
  const prompt = `請繪製一張橫式（3:2）的編輯插畫（editorial illustration）。
${CHARACTER}

這張圖要表達的概念／場景：${brief}

${COMPOSITION}

${PROFESSIONAL}

${STYLE}`;

  log.info({ brief }, 'Generating 湯懶懶 illustration');
  const { url } = await generateCoverImage(prompt, {
    aspectRatio: '3:2',
    referenceImages: REFERENCE_IMAGES,
  });

  // Re-host on Cloudinary so the URL is stable/public for Substack to import.
  const stableUrl = await uploadToCloudinary(url, `substack-sloth-${Date.now()}`);
  log.info({ stableUrl }, '湯懶懶 illustration ready');
  return stableUrl;
}
