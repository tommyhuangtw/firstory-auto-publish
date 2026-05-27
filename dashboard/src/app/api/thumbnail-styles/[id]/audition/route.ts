import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs-extra';
import { getDb } from '@/db';
import { generateCoverImage, downloadImage } from '@/services/imageService';

const OUTPUT_DIR = path.join(process.cwd(), '..', 'temp', 'thumbnails');

const REFERENCE_IMAGES = [
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1757600697/pfrlq5d5d5vtxqljgiht.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1758471943/xi6cwkuwjenrw7shrqsj.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1758557835/n2qgte9m27xyimmxr56t.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1756213768/tzfsghgnxtilslfp6gi0.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1750843184/nwap9q7xy9oc7a7qjkw4.png',
];

const SLOTH_MOODS = [
  '驚嚇、震驚', '壞笑、搞怪', '無奈、哭笑不得', '得意、自信爆棚',
  '嫌棄、翻白眼', '入迷、著迷', '激動、興奮', '心虛、偷偷摸摸',
  '困、想睡', '感動、淚目', '疑惑、黑人問號', '挑釁、來啊',
];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const styleId = parseInt(id);
    if (isNaN(styleId)) {
      return NextResponse.json({ error: 'Invalid style id' }, { status: 400 });
    }

    if (!process.env.KIE_AI_API_KEY && !process.env.FAL_KEY) {
      return NextResponse.json({ error: 'No image generation key configured (KIE_AI_API_KEY or FAL_KEY)' }, { status: 500 });
    }

    const db = getDb();
    const style = db.prepare(
      'SELECT id, name, bg, text_style, layout FROM thumbnail_styles WHERE id = ?'
    ).get(styleId) as { id: number; name: string; bg: string; text_style: string; layout: string } | undefined;

    if (!style) {
      return NextResponse.json({ error: 'Style not found' }, { status: 404 });
    }

    const { hookTitle } = (await request.json().catch(() => ({}))) as { hookTitle?: string };

    // Use provided hook title or pick a random one from past episodes
    let title = hookTitle?.trim();
    if (!title) {
      const pastTitles = db.prepare(
        "SELECT DISTINCT yt_hook_title FROM episodes WHERE yt_hook_title IS NOT NULL AND yt_hook_title != '' ORDER BY id DESC LIMIT 50"
      ).all() as { yt_hook_title: string }[];
      title = pastTitles.length > 0
        ? pastTitles[Math.floor(Math.random() * pastTitles.length)].yt_hook_title
        : 'AI 新時代';
    }

    await fs.ensureDir(OUTPUT_DIR);

    const mood = SLOTH_MOODS[Math.floor(Math.random() * SLOTH_MOODS.length)];
    const prompt = `YouTube 縮圖，16:9，1920x1080。

標題：「${title}」

設計：
- 背景：${style.bg}
- 文字：${style.text_style}
- 構圖：${style.layout}

湯懶懶角色（參考提供的角色圖片）：
- 佔畫面 25-30%，放在一側
- 情緒方向：${mood}
- 表情和動作要誇張、好笑、吸睛

嚴格規則：
1. 極簡 — 最多 3 個視覺元素（文字 + 角色 + 0-1 個 icon）
2.「${title}」必須是超大粗體字，佔畫面 40-50%
3. 背景乾淨 — 純色、漸層、或極簡圖案
4. 最多只能有一行小副標題，不可有 bullet points、列表、或數據`;

    const { url: imageUrl } = await generateCoverImage(prompt, {
      model: 'gpt-image-2-image-to-image',
      aspectRatio: '16:9',
      resolution: '1K',
      referenceImages: REFERENCE_IMAGES,
    });

    const filename = `style_audition_${style.name}_${Date.now()}.png`;
    const filePath = path.join(OUTPUT_DIR, filename);
    await downloadImage(imageUrl, filePath);

    const serveUrl = `/api/thumbnail-compare/serve?file=${encodeURIComponent(filename)}`;

    // Update the style record with sample info
    db.prepare(
      'UPDATE thumbnail_styles SET sample_image_url = ?, sample_hook_title = ? WHERE id = ?'
    ).run(serveUrl, title, styleId);

    return NextResponse.json({ sampleImageUrl: serveUrl, hookTitle: title, styleName: style.name });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
