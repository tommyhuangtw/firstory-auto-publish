/**
 * YouTube Thumbnail Generator — renders HTML to 1280x720 JPEG via Playwright.
 *
 * Layout: left panel (brand badge + EP + title) | right panel (cover image).
 * Ported from src/services/thumbnailGenerator.js.
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs-extra';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('thumbnailGenerator');

interface ThumbnailOptions {
  title: string;
  episodeNumber: number;
  coverImagePath?: string;
  segmentType?: string;
}

function escapeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function calcFs(text: string, base: number): number {
  const len = text.replace(/<[^>]*>/g, '').length;
  if (len > 50) return Math.round(base * 0.7);
  if (len > 40) return Math.round(base * 0.8);
  if (len > 30) return Math.round(base * 0.9);
  return base;
}

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap');`;
const BASE_RESET = `* { margin:0; padding:0; box-sizing:border-box; } body { width:1280px; height:720px; font-family:'Noto Sans TC','Microsoft JhengHei',sans-serif; overflow:hidden; }`;

function buildWarmCream(opts: {
  escapedTitle: string;
  episodeNumber: number;
  brandName: string;
  description: string;
  bgImg: string;
}): string {
  const { escapedTitle, episodeNumber, brandName, description, bgImg } = opts;
  const titleWithEp = `EP${episodeNumber} ${escapedTitle}`;
  const fontSize = calcFs(titleWithEp, 52);

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
${FONT_IMPORT}${BASE_RESET}
.badge-brand {
  display:inline-block; align-self:flex-start;
  background:#f5f0ea; color:#6b5b3e; padding:12px 26px; border-radius:10px;
  font-size:24px; font-weight:900; letter-spacing:2px; border:1px solid rgba(107,91,62,0.15);
  margin-bottom:28px;
}
.wrap { width:1280px; height:720px; display:flex; }
.left {
  width:520px; height:720px; background:#faf7f2;
  display:flex; flex-direction:column; justify-content:center; padding:52px 48px;
  position:relative;
}
.left::after {
  content:''; position:absolute; top:0; right:0; width:5px; height:100%;
  background:linear-gradient(180deg,#c9956b,#e8c66a);
}
.title { color:#2c2417; font-size:${fontSize}px; font-weight:900; line-height:1.35; }
.ep { color:#c9956b; }
.divider { width:40px; height:3px; background:#c9956b; margin-top:20px; border-radius:2px; }
.desc { margin-top:14px; color:#b5a48a; font-size:14px; font-weight:500; letter-spacing:0.5px; }
.right { flex:1; height:720px; ${bgImg} position:relative; }
.right-ov { position:absolute; inset:0; background:linear-gradient(90deg,rgba(250,247,242,0.3) 0%,transparent 15%); }
</style></head><body>
<div class="wrap">
  <div class="left">
    <div class="badge-brand">${brandName}</div>
    <div class="title"><span class="ep">EP${episodeNumber}</span> ${escapedTitle}</div>
    <div class="divider"></div>
    <div class="desc">${description}</div>
  </div>
  <div class="right"><div class="right-ov"></div></div>
</div></body></html>`;
}

export async function generateYouTubeThumbnail(options: ThumbnailOptions): Promise<string> {
  const { title, episodeNumber, coverImagePath } = options;
  const brandName = 'AI懶人報 Podcast';
  const description = '每日 AI 精華，幫你降低資訊焦慮';

  log.info({ episodeNumber, coverImagePath }, 'Generating YouTube thumbnail');

  let bgImg = 'background:#f5f0ea;';
  if (coverImagePath && await fs.pathExists(coverImagePath)) {
    const imageBuffer = await fs.readFile(coverImagePath);
    const ext = path.extname(coverImagePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    const coverBase64 = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
    bgImg = `background-image:url('${coverBase64}');background-size:cover;background-position:center;`;
  }

  const html = buildWarmCream({
    escapedTitle: escapeHtml(title),
    episodeNumber,
    brandName,
    description,
    bgImg,
  });

  const tempDir = path.resolve(process.cwd(), '..', 'temp');
  await fs.ensureDir(tempDir);
  const outputPath = path.join(tempDir, `thumbnail_yt_ep${episodeNumber}.jpg`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 1280, height: 720 },
  });
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: outputPath, type: 'jpeg', quality: 90 });
  } finally {
    await context.close();
    await browser.close();
  }

  const stats = await fs.stat(outputPath);
  log.info({ outputPath, sizeMB: (stats.size / (1024 * 1024)).toFixed(2) }, 'YouTube thumbnail generated');

  return outputPath;
}
