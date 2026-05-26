import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs-extra';
import { getDb } from '@/db';
import { generateCoverImage, downloadImage } from '@/services/imageService';
import { uploadToCloudinary } from '@/services/cloudinary';

const OUTPUT_DIR = path.join(process.cwd(), '..', 'temp', 'thumbnails');

const REFERENCE_IMAGES = [
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1757600697/pfrlq5d5d5vtxqljgiht.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1758471943/xi6cwkuwjenrw7shrqsj.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1758557835/n2qgte9m27xyimmxr56t.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1756213768/tzfsghgnxtilslfp6gi0.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1750843184/nwap9q7xy9oc7a7qjkw4.png',
];

import { type ThumbnailStyle, pickRandomStyles, getStyleByName } from '@/services/thumbnailStyles';

function buildPrompt(title: string, style: ThumbnailStyle | null, summary: string, options?: { extraPrompt?: string; hasReferenceImage?: boolean }): string {
  const styleSection = style
    ? `設計：
- 背景：${style.bg}
- 文字：${style.text}
- 構圖：${style.layout}`
    : `設計：
- 參考提供的第一張圖片的整體風格（配色、背景、構圖、文字排版）
- 在此基礎上做細微變化，保持相同的視覺調性`;

  const refNote = options?.hasReferenceImage && style
    ? '\n- 參考提供的第一張圖片作為風格基準，保持類似的視覺調性'
    : '';

  return `YouTube 縮圖，16:9，1920x1080。

標題：「${title}」

${styleSection}${refNote}

湯懶懶角色（參考提供的角色圖片）：
- 佔畫面 25-30%，放在一側
- 根據標題「${title}」的主題語氣，選擇最適合的表情和情緒（例如：技術拆解→好奇認真、爭議話題→驚訝震驚、教學類→自信得意、搞笑類→壞笑搞怪）
- 表情和動作要誇張、好笑、吸睛

${summary ? `主題（僅用來決定放什麼 icon，不要把文字印在圖上）：${summary.slice(0, 200)}` : ''}

嚴格規則：
1. 極簡 — 最多 3 個視覺元素（文字 + 角色 + 0-1 個 icon）
2.「${title}」必須是超大粗體字，佔畫面 40-50%
3. 背景乾淨 — 純色、漸層、或極簡圖案
4. 最多只能有一行小副標題，不可有 bullet points、列表、或數據
5. summary 內容僅供參考選擇 icon，禁止直接印在圖上${options?.extraPrompt ? `\n\n額外要求：${options.extraPrompt}` : ''}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const episodeId = parseInt(id);
    if (isNaN(episodeId)) {
      return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
    }

    const { hookTitle, styleName, extraPrompt, referenceImagePath } = (await request.json()) as { hookTitle: string; styleName?: string; extraPrompt?: string; referenceImagePath?: string };
    if (!hookTitle?.trim()) {
      return NextResponse.json({ error: 'hookTitle is required' }, { status: 400 });
    }

    if (!process.env.KIE_AI_API_KEY && !process.env.FAL_KEY) {
      return NextResponse.json({ error: 'No image generation key configured (KIE_AI_API_KEY or FAL_KEY)' }, { status: 500 });
    }

    const db = getDb();
    const episode = db.prepare('SELECT script_summary FROM episodes WHERE id = ?').get(episodeId) as { script_summary: string | null } | undefined;
    const summary = episode?.script_summary || '';

    await fs.ensureDir(OUTPUT_DIR);

    // Upload reference thumbnail to Cloudinary if provided (kie.ai needs public URLs)
    let refImageUrl: string | null = null;
    if (referenceImagePath && await fs.pathExists(referenceImagePath)) {
      refImageUrl = await uploadToCloudinary(referenceImagePath, `ref_thumb_${Date.now()}`);
    }

    // If styleName specified, generate 1 with that style; otherwise 2 random styles from enabled pool
    // If styleName doesn't match any known style but we have a reference image, use null (rely on reference)
    const matchedStyle = styleName ? getStyleByName(styleName) : null;
    const stylesToUse: (ThumbnailStyle | null)[] = styleName
      ? [matchedStyle || null] // null = unknown style, rely on reference image
      : pickRandomStyles(2);

    // Put reference thumbnail first so it has highest weight as style reference
    const refs = refImageUrl
      ? [refImageUrl, ...REFERENCE_IMAGES]
      : REFERENCE_IMAGES;

    const hasRef = !!refImageUrl;

    const results = await Promise.all(
      stylesToUse.map(async (style, idx) => {
        const label = String.fromCharCode(97 + idx); // a, b
        const prompt = buildPrompt(hookTitle.trim(), style, summary, { extraPrompt, hasReferenceImage: hasRef });
        const { url: imageUrl } = await generateCoverImage(prompt, {
          model: 'gpt-image-2-image-to-image',
          aspectRatio: '16:9',
          resolution: '1K',
          referenceImages: refs,
        });
        const filename = `ep${episodeId}_yt_${style?.name || 'ref'}_${Date.now()}.png`;
        const filePath = path.join(OUTPUT_DIR, filename);
        await downloadImage(imageUrl, filePath);
        return { path: filePath, url: `/api/thumbnail-compare/serve?file=${encodeURIComponent(filename)}`, style: style?.name || 'ref' };
      }),
    );

    return NextResponse.json({ thumbnails: results });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const episodeId = parseInt(id);
    if (isNaN(episodeId)) {
      return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
    }

    const prefix = `ep${episodeId}_yt_`;
    const exists = await fs.pathExists(OUTPUT_DIR);
    if (!exists) return NextResponse.json({ thumbnails: [] });

    const files = (await fs.readdir(OUTPUT_DIR))
      .filter((f: string) => f.startsWith(prefix) && f.endsWith('.png'))
      .sort()
      .reverse(); // newest first

    const thumbnails = files.map((f: string) => {
      // filename: ep23_yt_clean-white_1777943666319.png
      // extract style between ep{id}_yt_ and _timestamp.png
      const withoutPrefix = f.slice(prefix.length); // clean-white_1777943666319.png
      const lastUnderscore = withoutPrefix.lastIndexOf('_');
      const style = lastUnderscore > 0 ? withoutPrefix.slice(0, lastUnderscore) : 'unknown';
      return {
        path: path.join(OUTPUT_DIR, f),
        url: `/api/thumbnail-compare/serve?file=${encodeURIComponent(f)}`,
        style,
      };
    });

    return NextResponse.json({ thumbnails });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
