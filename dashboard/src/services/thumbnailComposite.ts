/**
 * Thumbnail text overlay service.
 *
 * Composites bold text onto a background image using sharp + SVG text rendering.
 * Used by the GPT Image thumbnail route to overlay hook text on AI-generated backgrounds.
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs-extra';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('thumbnailComposite');

const OUTPUT_DIR = path.join(process.cwd(), '..', 'temp', 'thumbnails');

interface CompositeOptions {
  backgroundPath: string;
  text: string;
  outputPath?: string;
  width?: number;
  height?: number;
  fontSize?: number;
}

/**
 * Overlay bold white text with dark outline onto a background image.
 * Returns the path to the composited image.
 */
export async function compositeTextOnImage(options: CompositeOptions): Promise<string> {
  const {
    backgroundPath,
    text,
    width = 1280,
    height = 720,
    fontSize: customFontSize,
  } = options;

  // Build SVG text overlay
  const escapedText = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Auto-wrap text to fit within image width (with padding)
  const maxTextWidth = width * 0.85; // 85% of image width
  // Estimate: CJK chars ≈ fontSize, latin/digit ≈ fontSize*0.6
  function estimateLineWidth(line: string, fs: number): number {
    let w = 0;
    for (const ch of line) {
      w += /[\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef]/.test(ch) ? fs : fs * 0.6;
    }
    return w;
  }

  function wrapText(input: string, fs: number): string[] {
    const result: string[] = [];
    let current = '';
    for (const ch of input) {
      const test = current + ch;
      if (estimateLineWidth(test, fs) > maxTextWidth && current.length > 0) {
        result.push(current);
        current = ch;
      } else {
        current = test;
      }
    }
    if (current) result.push(current);
    return result;
  }

  // Auto-size font: start large, reduce if too many lines
  const charCount = text.length;
  let fontSize = customFontSize ?? (charCount <= 4 ? 110 : charCount <= 6 ? 95 : charCount <= 8 ? 80 : charCount <= 12 ? 68 : 58);

  let lines = wrapText(escapedText, fontSize);
  // If more than 2 lines, reduce font size and re-wrap
  if (!customFontSize && lines.length > 2) {
    fontSize = Math.max(42, Math.floor(fontSize * 0.75));
    lines = wrapText(escapedText, fontSize);
  }
  const lineHeight = fontSize * 1.3;
  const totalTextHeight = lines.length * lineHeight;
  const startY = (height - totalTextHeight) / 2 + fontSize;

  const textElements = lines
    .map((line, i) => {
      const y = startY + i * lineHeight;
      return `
        <text x="${width / 2}" y="${y}" text-anchor="middle"
          font-family="PingFang TC, Noto Sans TC, system-ui, sans-serif"
          font-size="${fontSize}" font-weight="900"
          fill="white" stroke="black" stroke-width="4" paint-order="stroke">
          ${line}
        </text>`;
    })
    .join('');

  const svgOverlay = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <!-- Semi-transparent dark overlay for text contrast -->
      <rect width="${width}" height="${height}" fill="rgba(0,0,0,0.3)" />
      ${textElements}
    </svg>`;

  // Generate output path
  const outputPath =
    options.outputPath ??
    path.join(OUTPUT_DIR, `composite_${Date.now()}.png`);

  await fs.ensureDir(path.dirname(outputPath));

  // Resize background and composite text
  await sharp(backgroundPath)
    .resize(width, height, { fit: 'cover' })
    .composite([
      {
        input: Buffer.from(svgOverlay),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toFile(outputPath);

  log.info({ outputPath, text: text.slice(0, 30) }, 'Thumbnail composited');
  return outputPath;
}
