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
