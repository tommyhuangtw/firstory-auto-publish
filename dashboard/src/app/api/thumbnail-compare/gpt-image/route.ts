import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs-extra';
import { generateCoverImage, downloadImage } from '@/services/kieai';

const OUTPUT_DIR = path.join(process.cwd(), '..', 'temp', 'thumbnails');

// 湯懶懶 reference images (same as generateCover.ts)
const REFERENCE_IMAGES = [
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1757600697/pfrlq5d5d5vtxqljgiht.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1758471943/xi6cwkuwjenrw7shrqsj.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1758557835/n2qgte9m27xyimmxr56t.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1756213768/tzfsghgnxtilslfp6gi0.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1750843184/nwap9q7xy9oc7a7qjkw4.png',
];

// ---------- Style system ----------
// Inspired by top YouTube thumbnails: SIMPLE, few elements, huge text, clean backgrounds

interface ThumbnailStyle {
  name: string;
  bg: string;
  text: string;
  layout: string;
}

const STYLES: ThumbnailStyle[] = [
  {
    name: 'clean-white',
    bg: 'Plain white or very light gray background, completely clean',
    text: 'Black bold sans-serif title, very large',
    layout: 'Title text on right 60%, 1-2 small product logos/icons on left side',
  },
  {
    name: 'dark-simple',
    bg: 'Solid black or very dark charcoal background',
    text: 'White bold sans-serif title, very large, maybe one word highlighted in a color',
    layout: 'Title text centered or on right, 1 simple icon or screenshot on left',
  },
  {
    name: 'gradient-text',
    bg: 'Solid dark background (black, dark blue, or dark purple)',
    text: 'Title with gradient fill (blue→purple or orange→pink), extremely large and bold',
    layout: 'Giant gradient text centered, 1 small logo or icon above or below',
  },
  {
    name: 'split-color',
    bg: 'Left half one solid color, right half another solid color (e.g. dark navy | light gray)',
    text: 'Bold white text spanning across both halves',
    layout: 'Title text centered across the color split, 1 icon on each side',
  },
  {
    name: 'screenshot-focus',
    bg: 'Light/white background with a clean UI screenshot or laptop mockup showing a product',
    text: 'Bold black or dark text above or beside the screenshot',
    layout: 'Screenshot/laptop on one side (40%), big title text on the other side (60%)',
  },
  {
    name: 'icon-grid',
    bg: 'Clean white or light background',
    text: 'Large bold text at bottom half',
    layout: 'Row of 3-5 small app icons or logos across the top, huge title text below',
  },
  {
    name: 'accent-bar',
    bg: 'White or light background with a bold colored accent bar (red, blue, or orange) at top or bottom',
    text: 'Dark bold text, very large, with one keyword in the accent color',
    layout: 'Big text taking 70% of space, colored accent bar for emphasis',
  },
  {
    name: 'dark-glow',
    bg: 'Black background with a subtle colored glow or light source behind the text',
    text: 'Bright white or colored text with soft glow effect, extremely bold',
    layout: 'Centered glowing text, 1-2 tiny icons nearby, mostly negative space',
  },
  {
    name: 'diagram-clean',
    bg: 'White or light gray background with a simple flowchart or diagram (3-5 nodes with arrows)',
    text: 'Bold dark text at top or bottom, clean and professional',
    layout: 'Simple diagram in center, title text above or below it',
  },
  {
    name: 'bold-emoji',
    bg: 'Solid bright background (yellow, red, or blue)',
    text: 'Giant white or black text with 1-2 relevant emojis placed next to it',
    layout: 'Text + emoji only, nothing else, maximum simplicity',
  },
  {
    name: 'terminal',
    bg: 'Black terminal/code editor background with minimal green or blue code snippets',
    text: 'Large monospace or sans-serif white/green text as the title',
    layout: 'Terminal window frame, title text in center, minimal code decoration around edges',
  },
  {
    name: 'newspaper',
    bg: 'Off-white newspaper texture with subtle column lines',
    text: 'Large black serif headline text like a breaking news front page',
    layout: 'Giant headline text centered, small "號外" or "BREAKING" red stamp in corner',
  },
];

function pickRandomStyle(): ThumbnailStyle {
  return STYLES[Math.floor(Math.random() * STYLES.length)];
}

// 湯懶懶 emotion direction — give AI creative freedom, just set the vibe
const SLOTH_MOODS = [
  '驚嚇、震驚',
  '壞笑、搞怪',
  '無奈、哭笑不得',
  '得意、自信爆棚',
  '嫌棄、翻白眼',
  '入迷、著迷',
  '激動、興奮',
  '心虛、偷偷摸摸',
  '困、想睡',
  '感動、淚目',
  '疑惑、黑人問號',
  '挑釁、來啊',
];

function pickRandomMood(): string {
  return SLOTH_MOODS[Math.floor(Math.random() * SLOTH_MOODS.length)];
}

// Core design principle: YouTube thumbnails are SIMPLE
// - Max 2-3 visual elements total
// - Text takes up 40-60% of the image
// - Clean background, lots of breathing room
// - 1-2 icons/logos max, not illustrations

function buildT2IPrompt(title: string, style: ThumbnailStyle, summaryText: string): string {
  return `YouTube thumbnail, 16:9, 1920x1080.

TITLE: "${title}"

Design:
- Background: ${style.bg}
- Text: ${style.text}
- Layout: ${style.layout}

${summaryText ? `Topic (only use to decide which 1 icon/logo to show — do NOT render this text in the image): ${summaryText.slice(0, 200)}` : ''}

STRICT RULES:
1. KEEP IT SIMPLE — maximum 3 visual elements total (text + 1-2 icons/logos)
2. "${title}" must be HUGE, bold, readable — the dominant element
3. Background must be CLEAN — no busy illustrations, no complex scenes
4. At most 1 small subtitle line allowed. NO bullet points, NO lists, NO data/stats
5. Icons must be large and recognizable, or don't include any — 1 big icon beats 3 small ones
6. NO decorative elements, NO borders, NO complex patterns`;
}

function buildI2IPrompt(title: string, style: ThumbnailStyle, summaryText: string): string {
  const mood = pickRandomMood();
  return `YouTube 縮圖，16:9，1920x1080。

標題：「${title}」

設計：
- 背景：${style.bg}
- 文字：${style.text}
- 構圖：${style.layout}

湯懶懶角色（參考提供的圖片）：
- 佔畫面 25-30%，放在一側
- 情緒方向：${mood}
- 根據標題主題自由發揮表情和動作，要誇張、好笑、吸睛
- 每次的表情和姿勢都要不同，展現角色的個性

${summaryText ? `主題（僅用來決定放什麼 icon，不要把文字印在圖上）：${summaryText.slice(0, 200)}` : ''}

嚴格規則：
1. 極簡 — 最多 3 個視覺元素（文字 + 角色 + 0-1 個 icon）
2.「${title}」必須是超大粗體字，佔畫面 40-50%
3. 背景乾淨 — 純色、漸層、或極簡圖案
4. 最多只能有一行小副標題，不可有 bullet points、列表、或數據
5. summary 內容僅供參考選擇 icon，禁止直接印在圖上`;
}

export { STYLES };

// ---------- Route handler ----------

export async function POST(request: NextRequest) {
  try {
    const { hookText, segmentType, episodeSummary, mode, styleName } = (await request.json()) as {
      hookText: string;
      segmentType: string;
      episodeSummary?: string;
      mode?: 'text-to-image' | 'image-to-image';
      styleName?: string;
    };

    if (!hookText?.trim()) {
      return NextResponse.json({ error: 'hookText is required' }, { status: 400 });
    }

    if (!process.env.KIE_AI_API_KEY) {
      return NextResponse.json({ error: 'KIE_AI_API_KEY not configured' }, { status: 500 });
    }

    await fs.ensureDir(OUTPUT_DIR);
    const ts = Date.now();
    const useI2I = mode === 'image-to-image';
    const title = hookText.trim();
    const summaryText = episodeSummary?.trim() || '';

    // Pick style: use specified style or random
    const style = styleName
      ? STYLES.find((s) => s.name === styleName) || pickRandomStyle()
      : pickRandomStyle();

    const bgPrompt = useI2I
      ? buildI2IPrompt(title, style, summaryText)
      : buildT2IPrompt(title, style, summaryText);

    const imageUrl = await generateCoverImage(bgPrompt, {
      model: useI2I ? 'gpt-image-2-image-to-image' : 'gpt-image-2-text-to-image',
      aspectRatio: '16:9',
      resolution: '1K',
      referenceImages: useI2I ? REFERENCE_IMAGES : undefined,
    });

    // Download final image (text is already baked in)
    const prefix = useI2I ? 'gpt_i2i' : 'gpt_t2i';
    const filename = `${prefix}_${ts}.png`;
    const filePath = path.join(OUTPUT_DIR, filename);
    await downloadImage(imageUrl, filePath);

    return NextResponse.json({
      url: `/api/thumbnail-compare/serve?file=${encodeURIComponent(filename)}`,
      method: useI2I ? 'gpt-image-i2i' : 'gpt-image-t2i',
      style: style.name,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
