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

const CHARACTER = `主角為「湯懶懶 Mr. Sloth」——一隻慵懶療癒但其實很懂效率的樹懶，擅長把瑣事交給 AI、自己專注耍廢喝珍奶。請嚴格參考提供的參考圖，保持同一個角色外型。`;

const STYLE = `風格：溫暖療癒的繪本插畫感、柔和暖色調（奶油白、焦糖、暖黃），乾淨不雜亂，湯懶懶為視覺主角佔據焦點，背景留適度空白、畫面不要過滿。橫式構圖。
重要：受眾是台灣人，畫面中所有文字標籤一律用「繁體中文（台灣用語）」，只有本來就是英文的專有名詞或技術術語（例如 AI、TDD、API、Claude、ChatGPT）才保留英文。文字要少、字級要大、清楚易讀，不要一堆小字。`;

/**
 * Generate one in-article 湯懶懶 illustration for a scene brief.
 * Returns a stable Cloudinary URL. Throws on failure (caller decides fallback).
 */
export async function generateSlothIllustration(brief: string): Promise<string> {
  const prompt = `請繪製一張橫式（3:2）Instagram 插畫風格的編輯插圖。
${CHARACTER}

場景：${brief}

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
