import { getDb } from '@/db';

export interface ThumbnailStyle {
  name: string;
  bg: string;
  text: string;
  layout: string;
}

export interface ThumbnailStyleRow extends ThumbnailStyle {
  id: number;
  isEnabled: boolean;
  source: 'seed' | 'generated';
  sampleImageUrl: string | null;
  sampleHookTitle: string | null;
  generatedAt: string | null;
  createdAt: string;
  usageCount: number; // # of YouTube-published episodes that used this style
}

// Single source of truth — the 12 original styles
export const SEED_STYLES: ThumbnailStyle[] = [
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

// ---------- DB helpers ----------

interface DbStyleRow {
  id: number;
  name: string;
  bg: string;
  text_style: string;
  layout: string;
  is_enabled: number;
  source: string;
  sample_image_url: string | null;
  sample_hook_title: string | null;
  generated_at: string | null;
  created_at: string;
  usage_count: number | null;
}

function mapRow(r: DbStyleRow): ThumbnailStyleRow {
  return {
    id: r.id,
    name: r.name,
    bg: r.bg,
    text: r.text_style,
    layout: r.layout,
    isEnabled: r.is_enabled === 1,
    source: r.source as 'seed' | 'generated',
    sampleImageUrl: r.sample_image_url,
    sampleHookTitle: r.sample_hook_title,
    generatedAt: r.generated_at,
    createdAt: r.created_at,
    usageCount: r.usage_count ?? 0,
  };
}

/** Seed the 12 built-in styles if table is empty */
export function seedThumbnailStyles(): void {
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) as c FROM thumbnail_styles').get() as { c: number }).c;
  if (count > 0) return;

  const insert = db.prepare(
    'INSERT INTO thumbnail_styles (name, bg, text_style, layout, source) VALUES (?, ?, ?, ?, ?)'
  );
  for (const s of SEED_STYLES) {
    insert.run(s.name, s.bg, s.text, s.layout, 'seed');
  }
}

/**
 * Extract the style slug from a generated YouTube thumbnail filename.
 * Pattern: ep{episodeId}_yt_{styleName}_{timestamp}.png
 * Returns null for manual uploads ('upload'), reference-based ('ref'),
 * composite fallbacks, or anything that doesn't match.
 */
function parseStyleFromThumbnailPath(thumbnailPath: string): string | null {
  const base = (thumbnailPath.split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '');
  const m = base.match(/^ep\d+_yt_(.+)_\d+$/);
  if (!m) return null;
  const name = m[1];
  if (name === 'upload' || name === 'ref') return null;
  return name;
}

/**
 * Recompute per-style usage from YouTube-published episodes and apply the
 * auto-retire rule: a style used by >=2 published episodes is hard-deleted;
 * otherwise its usage_count is updated for display.
 *
 * Recompute-based (not incremental) so it's idempotent — safe to call on every
 * publish and at startup (which also serves as the one-time history backfill).
 * Deleted styles whose names still appear in history simply no-op on delete.
 */
export function reconcileStyleUsage(): { counts: Record<string, number>; deleted: string[] } {
  const db = getDb();
  const episodes = db.prepare(
    'SELECT yt_thumbnail_path FROM episodes WHERE youtube_url IS NOT NULL AND yt_thumbnail_path IS NOT NULL'
  ).all() as { yt_thumbnail_path: string }[];

  const counts = new Map<string, number>();
  for (const e of episodes) {
    const style = parseStyleFromThumbnailPath(e.yt_thumbnail_path);
    if (style) counts.set(style, (counts.get(style) || 0) + 1);
  }

  const styles = db.prepare('SELECT id, name FROM thumbnail_styles').all() as { id: number; name: string }[];
  const del = db.prepare('DELETE FROM thumbnail_styles WHERE id = ?');
  const upd = db.prepare('UPDATE thumbnail_styles SET usage_count = ? WHERE id = ?');
  const deleted: string[] = [];

  const tx = db.transaction(() => {
    for (const s of styles) {
      const c = counts.get(s.name) || 0;
      if (c >= 2) {
        del.run(s.id);
        deleted.push(s.name);
      } else {
        upd.run(c, s.id);
      }
    }
  });
  tx();

  return { counts: Object.fromEntries(counts), deleted };
}

/** All styles with full metadata (for management UI) */
export function getAllStyles(): ThumbnailStyleRow[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM thumbnail_styles ORDER BY source ASC, id ASC').all() as DbStyleRow[];
  return rows.map(mapRow);
}

/** Only enabled styles (for random pool) */
export function getEnabledStyles(): ThumbnailStyle[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT name, bg, text_style, layout FROM thumbnail_styles WHERE is_enabled = 1'
  ).all() as DbStyleRow[];
  return rows.map(r => ({ name: r.name, bg: r.bg, text: r.text_style, layout: r.layout }));
}

/** Pick N random styles from enabled pool */
export function pickRandomStyles(count: number): ThumbnailStyle[] {
  const enabled = getEnabledStyles();
  if (enabled.length === 0) throw new Error('No enabled thumbnail styles — enable at least one style');
  const shuffled = [...enabled].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/** Find a specific style by name (searches all styles, not just enabled) */
export function getStyleByName(name: string): ThumbnailStyle | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT name, bg, text_style, layout FROM thumbnail_styles WHERE name = ?'
  ).get(name) as DbStyleRow | undefined;
  if (!row) return null;
  return { name: row.name, bg: row.bg, text: row.text_style, layout: row.layout };
}

export interface GeneratedStyle { id: number; name: string; bg: string; text: string; layout: string }

/**
 * Generate `count` new thumbnail style definitions via LLM and insert them
 * (is_enabled=0, source='generated') for human review. Returns the inserted rows.
 * Shared by the /generate API route and the biweekly scheduler job.
 */
export async function generateStyles(count: number): Promise<GeneratedStyle[]> {
  const numStyles = Math.min(Math.max(count, 1), 30);
  const { LLMService } = await import('@/services/llmService');

  const db = getDb();
  const existing = db.prepare('SELECT name, bg, text_style, layout FROM thumbnail_styles').all() as
    { name: string; bg: string; text_style: string; layout: string }[];
  const existingNames = existing.map(s => s.name);
  const existingDefs = existing.map(s => ({ name: s.name, bg: s.bg, text: s.text_style, layout: s.layout }));

  const llm = new LLMService();
  const batchSize = 10;
  const batches = Math.ceil(numStyles / batchSize);
  const allInserted: GeneratedStyle[] = [];
  const now = new Date().toISOString();
  const insert = db.prepare(
    'INSERT INTO thumbnail_styles (name, bg, text_style, layout, is_enabled, source, generated_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
  );

  for (let batch = 0; batch < batches; batch++) {
    const batchCount = Math.min(batchSize, numStyles - batch * batchSize);

    const result = await llm.call({
      stage: 'thumbnail_style_discovery',
      messages: [{
        role: 'user',
        content: `You are a YouTube thumbnail design strategist specializing in tech/AI content.
Generate ${batchCount} NEW thumbnail style definitions. Each must be unique and different from existing styles.

Each style is a JSON object with exactly these fields:
- name: kebab-case slug, 2-3 words (e.g. "neon-outline", "retro-vhs")
- bg: background description, 1-2 sentences
- text: text styling description, 1-2 sentences
- layout: spatial layout, 1 sentence

Design for HIGH CTR YouTube thumbnails:
- Maximum 2-3 visual elements total
- Title text dominates 40-60% of image
- Clean, uncluttered backgrounds
- Bold, readable at mobile thumbnail size
- High contrast between text and background

Consider trending YouTube styles:
- 3D text with dramatic shadows/depth
- Cinematic color grading (teal/orange, moody blues)
- Bold color blocking with neon accents
- Retro/VHS/glitch aesthetics
- Minimalist flat with oversized typography
- Duotone or tritone color treatments
- Glassmorphism / frosted glass panels
- Comic/manga inspired bold outlines
- Isometric/3D illustration backgrounds
- Holographic/iridescent gradients
- Polaroid / instant photo frame
- Chalkboard / hand-drawn sketch
- Neon sign on brick wall
- Blueprint / technical drawing
- Watercolor wash backgrounds
- Pop art / halftone dots
- Cyberpunk / synthwave
- Paper cutout / collage
- Sticker / badge collection
- Vintage poster / propaganda

EXISTING STYLES — each new style MUST be visually distinct from ALL of these (different background treatment, different text effect, different overall aesthetic):
${JSON.stringify(existingDefs, null, 1)}

Output ONLY a valid JSON array of ${batchCount} objects. No markdown fences, no explanation.`,
      }],
      options: {
        preferredModel: 'google/gemini-2.5-flash',
        maxTokens: 3000,
        temperature: 0.95,
      },
    });

    if (!result.success || !result.content) continue;

    let cleaned = result.content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    let parsed: Array<{ name: string; bg: string; text: string; layout: string }>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      continue; // skip this batch on parse failure
    }

    const valid = parsed.filter(s =>
      s.name && s.bg && s.text && s.layout && !existingNames.includes(s.name)
    );

    for (const s of valid) {
      try {
        const info = insert.run(s.name, s.bg, s.text, s.layout, 'generated', now);
        allInserted.push({ id: Number(info.lastInsertRowid), name: s.name, bg: s.bg, text: s.text, layout: s.layout });
        existingNames.push(s.name); // prevent cross-batch duplicates
        existingDefs.push({ name: s.name, bg: s.bg, text: s.text, layout: s.layout });
      } catch {
        // name conflict — skip
      }
    }
  }

  return allInserted;
}

const AUDITION_REFERENCE_IMAGES = [
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1757600697/pfrlq5d5d5vtxqljgiht.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1758471943/xi6cwkuwjenrw7shrqsj.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1758557835/n2qgte9m27xyimmxr56t.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1756213768/tzfsghgnxtilslfp6gi0.png',
  'https://res.cloudinary.com/dxurvdax4/image/upload/v1750843184/nwap9q7xy9oc7a7qjkw4.png',
];

const AUDITION_SLOTH_MOODS = [
  '驚嚇、震驚', '壞笑、搞怪', '無奈、哭笑不得', '得意、自信爆棚',
  '嫌棄、翻白眼', '入迷、著迷', '激動、興奮', '心虛、偷偷摸摸',
  '困、想睡', '感動、淚目', '疑惑、黑人問號', '挑釁、來啊',
];

export interface AuditionResult { sampleImageUrl: string; hookTitle: string; styleName: string }

/**
 * Generate a sample preview image for one style (kie.ai GPT-Image) and persist it on
 * the style row. Shared by the /[id]/audition API route and the biweekly scheduler job.
 */
export async function auditionStyle(styleId: number, hookTitle?: string): Promise<AuditionResult> {
  if (!process.env.KIE_AI_API_KEY && !process.env.FAL_KEY) {
    throw new Error('No image generation key configured (KIE_AI_API_KEY or FAL_KEY)');
  }
  const path = await import('path');
  const fs = (await import('fs-extra')).default;
  const { generateCoverImage, downloadImage } = await import('@/services/imageService');

  const db = getDb();
  const style = db.prepare(
    'SELECT id, name, bg, text_style, layout FROM thumbnail_styles WHERE id = ?'
  ).get(styleId) as { id: number; name: string; bg: string; text_style: string; layout: string } | undefined;
  if (!style) throw new Error('Style not found');

  let title = hookTitle?.trim();
  if (!title) {
    const pastTitles = db.prepare(
      "SELECT DISTINCT yt_hook_title FROM episodes WHERE yt_hook_title IS NOT NULL AND yt_hook_title != '' ORDER BY id DESC LIMIT 50"
    ).all() as { yt_hook_title: string }[];
    title = pastTitles.length > 0
      ? pastTitles[Math.floor(Math.random() * pastTitles.length)].yt_hook_title
      : 'AI 新時代';
  }

  const outputDir = path.join(process.cwd(), '..', 'temp', 'thumbnails');
  await fs.ensureDir(outputDir);

  const mood = AUDITION_SLOTH_MOODS[Math.floor(Math.random() * AUDITION_SLOTH_MOODS.length)];
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
    referenceImages: AUDITION_REFERENCE_IMAGES,
  });

  const filename = `style_audition_${style.name}_${Date.now()}.png`;
  await downloadImage(imageUrl, path.join(outputDir, filename));
  const serveUrl = `/api/thumbnail-compare/serve?file=${encodeURIComponent(filename)}`;

  db.prepare(
    'UPDATE thumbnail_styles SET sample_image_url = ?, sample_hook_title = ? WHERE id = ?'
  ).run(serveUrl, title, styleId);

  return { sampleImageUrl: serveUrl, hookTitle: title, styleName: style.name };
}
