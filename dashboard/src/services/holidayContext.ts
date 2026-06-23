/**
 * Holiday context for IG cover generation.
 *
 * Detects whether an episode's *publish day* lands on/near a major holiday and,
 * if so, returns the holiday's tier + motifs so the cover prompt can carry that vibe.
 *
 * Timezone correctness: the build machine clock can be ~7-8h behind Taiwan (UTC+8),
 * so we always compute the calendar date in Asia/Taipei. The cover is generated
 * ~½–1 day before it's published, so the *publish day* is Taipei(now)+1. We theme
 * when a holiday's themed span intersects {D, D+1} (D = Taipei production date).
 *
 * Lunar holidays (春節/端午/中秋/元宵/七夕) are resolved via lunar-javascript
 * (verified against known dates). Somber/high-risk days (清明/228/中元) are
 * deliberately NOT included — they get a normal content cover.
 */

import { Lunar } from 'lunar-javascript';

export type HolidayTier = 'takeover' | 'blend';

export interface HolidayMatch {
  key: string;
  name: string;
  tier: HolidayTier;
  motifs: string[];
}

interface HolidayDef {
  key: string;
  name: string;
  tier: HolidayTier;
  /** Length of the themed span in days, starting at resolveStart(year). Default 1. */
  spanDays: number;
  motifs: string[];
  /** Returns the UTC-midnight Date of the FIRST themed day for a given Gregorian year. */
  resolveStart: (gregYear: number) => Date;
}

const MS_DAY = 86_400_000;

/** Build a UTC-midnight Date for a calendar date (month is 1-based). */
function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * MS_DAY);
}

/** The calendar date "now" in Asia/Taipei, as a UTC-midnight Date. */
function taipeiToday(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find(p => p.type === t)!.value);
  return utcDate(get('year'), get('month'), get('day'));
}

/** Resolve the solar (Gregorian) date of a lunar month/day in a given lunar year. */
function lunarToUtc(gregYear: number, lunarMonth: number, lunarDay: number): Date {
  const s = Lunar.fromYmd(gregYear, lunarMonth, lunarDay).getSolar();
  return utcDate(s.getYear(), s.getMonth(), s.getDay());
}

const fixed = (month: number, day: number) => (gy: number) => utcDate(gy, month, day);
const lunar = (lm: number, ld: number) => (gy: number) => lunarToUtc(gy, lm, ld);

/** Nth occurrence of a weekday in a month (weekday: 0=Sun … 6=Sat). */
const nthWeekday = (month: number, weekday: number, n: number) => (gy: number) => {
  const first = utcDate(gy, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return utcDate(gy, month, 1 + offset + (n - 1) * 7);
};

/**
 * Curated holiday list. Tiers:
 *   takeover — holiday is the main subject of the image (festive).
 *   blend    — holiday woven into the AI/工具 content scene (festive).
 * Excluded by design: 清明 / 228 / 中元 (somber / high-risk).
 */
const HOLIDAYS: HolidayDef[] = [
  // ── takeover (大節日) ──
  {
    key: 'new_year',
    name: '元旦跨年',
    tier: 'takeover',
    spanDays: 2, // 12/31 跨年夜 → 1/1
    motifs: ['煙火', '倒數', '香檳', '101 跨年'],
    resolveStart: fixed(12, 31),
  },
  {
    key: 'spring_festival',
    name: '春節',
    tier: 'takeover',
    spanDays: 3, // 除夕 → 初二
    motifs: ['紅包', '燈籠', '春聯', '橘子', '招財貓'],
    resolveStart: (gy) => addDays(lunarToUtc(gy, 1, 1), -1), // 除夕 = 初一前一天
  },
  {
    key: 'dragon_boat',
    name: '端午節',
    tier: 'takeover',
    spanDays: 1,
    motifs: ['粽子', '龍舟', '香包', '艾草'],
    resolveStart: lunar(5, 5),
  },
  {
    key: 'mid_autumn',
    name: '中秋節',
    tier: 'takeover',
    spanDays: 1,
    motifs: ['月餅', '滿月', '柚子', '兔子', '烤肉'],
    resolveStart: lunar(8, 15),
  },
  {
    key: 'christmas',
    name: '聖誕節',
    tier: 'takeover',
    spanDays: 2, // 平安夜 → 聖誕節
    motifs: ['聖誕樹', '雪', '禮物', '薑餅'],
    resolveStart: fixed(12, 24),
  },

  // ── blend (一般節日) ──
  {
    key: 'lantern',
    name: '元宵節',
    tier: 'blend',
    spanDays: 1,
    motifs: ['湯圓', '花燈', '提燈籠', '猜燈謎'],
    resolveStart: lunar(1, 15),
  },
  {
    key: 'valentine',
    name: '西洋情人節',
    tier: 'blend',
    spanDays: 1,
    motifs: ['玫瑰', '巧克力', '愛心'],
    resolveStart: fixed(2, 14),
  },
  {
    key: 'children',
    name: '兒童節',
    tier: 'blend',
    spanDays: 1,
    motifs: ['氣球', '玩具', '糖果', '童趣'],
    resolveStart: fixed(4, 4),
  },
  {
    key: 'mothers',
    name: '母親節',
    tier: 'blend',
    spanDays: 1,
    motifs: ['康乃馨', '蛋糕', '擁抱媽媽'],
    resolveStart: nthWeekday(5, 0, 2), // 5月第2個週日
  },
  {
    key: 'qixi',
    name: '七夕情人節',
    tier: 'blend',
    spanDays: 1,
    motifs: ['鵲橋', '愛心', '牛郎織女', '星空'],
    resolveStart: lunar(7, 7),
  },
  {
    key: 'fathers',
    name: '父親節',
    tier: 'blend',
    spanDays: 1,
    motifs: ['領帶', '爸爸', '蛋糕'], // 8/8 諧音爸爸
    resolveStart: fixed(8, 8),
  },
  {
    key: 'teachers',
    name: '教師節',
    tier: 'blend',
    spanDays: 1,
    motifs: ['蘋果', '感謝卡', '黑板'],
    resolveStart: fixed(9, 28),
  },
  {
    key: 'national_day',
    name: '雙十國慶',
    tier: 'blend',
    spanDays: 1,
    motifs: ['國旗', '煙火', '慶典'],
    resolveStart: fixed(10, 10),
  },
  {
    key: 'halloween',
    name: '萬聖節',
    tier: 'blend',
    spanDays: 1,
    motifs: ['南瓜', '糖果', '變裝', '小鬼'],
    resolveStart: fixed(10, 31),
  },
];

const HOLIDAY_BY_KEY = new Map(HOLIDAYS.map(h => [h.key, h]));

function toMatch(def: HolidayDef): HolidayMatch {
  return { key: def.key, name: def.name, tier: def.tier, motifs: def.motifs };
}

/**
 * Detect the holiday to theme the cover for, or null if none is near.
 * @param now defaults to the current time.
 */
export function detectHoliday(now: Date = new Date()): HolidayMatch | null {
  const D = taipeiToday(now);
  const D1 = addDays(D, 1); // publish day (cover is seen ~½–1 day after generation)
  const dYear = D.getUTCFullYear();

  // Resolve each holiday across adjacent years so spans crossing a year boundary
  // (e.g. 元旦 12/31→1/1, 春節 in Jan) are caught regardless of the current date.
  const candidates: { match: HolidayMatch; start: Date }[] = [];
  for (const def of HOLIDAYS) {
    for (const gy of [dYear - 1, dYear, dYear + 1]) {
      const start = def.resolveStart(gy);
      const end = addDays(start, def.spanDays - 1);
      // Themed if the span intersects {D, D+1}.
      const hit =
        (D.getTime() >= start.getTime() && D.getTime() <= end.getTime()) ||
        (D1.getTime() >= start.getTime() && D1.getTime() <= end.getTime());
      if (hit) {
        candidates.push({ match: toMatch(def), start });
        break; // one resolved occurrence per holiday is enough
      }
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].match;

  // Conflict: higher tier wins, then nearest start to the publish day.
  const tierRank = (t: HolidayTier) => (t === 'takeover' ? 0 : 1);
  candidates.sort((a, b) => {
    const t = tierRank(a.match.tier) - tierRank(b.match.tier);
    if (t !== 0) return t;
    return Math.abs(a.start.getTime() - D1.getTime()) - Math.abs(b.start.getTime() - D1.getTime());
  });
  return candidates[0].match;
}

/** Look up a holiday by key for the manual override path. Returns null if unknown. */
export function getHolidayByKey(key: string): HolidayMatch | null {
  const def = HOLIDAY_BY_KEY.get(key);
  return def ? toMatch(def) : null;
}

export function getAllHolidayKeys(): string[] {
  return HOLIDAYS.map(h => h.key);
}

/** Directive injected into the IG scenario prompt (the 小劇場 designer). */
export function buildScenarioHolidayDirective(match: HolidayMatch): string {
  const motifs = match.motifs.join('、');
  if (match.tier === 'takeover') {
    return `\n\n🎉 重要節慶提示：現在正逢【${match.name}】。請以【${match.name}】作為這則情境的主軸（湯懶懶在過${match.name}），AI/工具元素可淡化或自然帶過即可。請自然帶入節慶氛圍與元素：${motifs}。`;
  }
  return `\n\n🎉 節慶提示：現在正逢【${match.name}】。請在原本的 AI/工具情境中「自然融入」${match.name}的氛圍與元素（兩者並存、不喧賓奪主），讓畫面同時有節慶感與內容感。可參考節慶元素：${motifs}。`;
}

/** Directive injected into the kie.ai image prompt. */
export function buildImageHolidayDirective(match: HolidayMatch): string {
  const motifs = match.motifs.join('、');
  const focus =
    match.tier === 'takeover'
      ? '節慶氛圍應為畫面的主視覺重點'
      : '在維持原情境的同時自然帶入節慶氛圍';
  return `\n\n---\n\n🎊 節慶主題：【${match.name}】\n${focus}。請自然融入以下節慶元素（最多挑選 2 個，與既有道具合計不超過 4 個，避免畫面雜亂）：${motifs}。色調可帶入節慶感，但仍維持湯懶懶整體可愛療癒的插畫風格。`;
}
