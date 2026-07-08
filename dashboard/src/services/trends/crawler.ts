/**
 * Threads Web Crawler — scrapes trending topics + top posts using a logged-in
 * 分身 (burner) account via Playwright, reusing the SoundOn persistent-context
 * pattern (login once, reuse cookies across runs).
 *
 * Threads has no official "trending topics" endpoint and its web DOM uses hashed
 * class names, so selectors are centralized below and kept resilient (best-effort,
 * with a curated-seed fallback). Tune SELECTORS during the headful first-login
 * smoke test (PLAYWRIGHT_HEADLESS=false).
 *
 * Low volume by design: ~3 runs/day, slowMo pacing, one browser context per run.
 */

import path from 'path';
import fs from 'fs';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import type { RawThreadPost } from './types';

const log = createChildLogger('trend-crawler');

const THREADS_BASE = process.env.THREADS_WEB_BASE || 'https://www.threads.com';
const SEARCH_URL = `${THREADS_BASE}/search`;

// Centralised, best-effort selectors — tune against the real account during the
// headful smoke test. Each is a comma-separated list tried in order.
const SELECTORS = {
  loginUsername: 'input[autocomplete="username"], input[name="username"], input[type="text"]',
  loginPassword: 'input[type="password"], input[name="password"]',
  loginSubmit: 'div[role="button"]:has-text("Log in"), button:has-text("Log in"), button[type="submit"]',
  // A logged-in shell shows the composer / create button.
  loggedInMarker: 'a[href="/login"], svg[aria-label="Create"], svg[aria-label="新貼文"], [aria-label="Create"]',
};

// ── Human-like pacing helpers (keep footprint low + avoid bot fingerprints) ──
function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
async function humanPause(page: import('playwright').Page, min = 1500, max = 4000): Promise<void> {
  await page.waitForTimeout(rand(min, max));
}
/** True with probability p (0..1) — used to add irregular, human-ish behaviour. */
function chance(p: number): boolean {
  return Math.random() < p;
}
/** Fisher-Yates shuffle (returns a new array). Randomising topic order per scan makes
 *  the search sequence non-deterministic — a fixed order is a scraper tell. */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Stealth init script — patches the biggest headless/automation fingerprints that
 *  survive `--disable-blink-features=AutomationControlled`. Injected into every page
 *  BEFORE site scripts run, so Threads' bot checks see a normal-looking browser. */
const STEALTH_INIT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['zh-TW', 'zh', 'en-US', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  window.chrome = window.chrome || { runtime: {} };
  const _query = window.navigator.permissions && window.navigator.permissions.query;
  if (_query) {
    window.navigator.permissions.query = (p) =>
      p && p.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : _query(p);
  }
`;

function getThreadsCreds(): { username: string; password: string } | null {
  const db = getDb();
  const get = (k: string) =>
    (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value;
  const username = process.env.THREADS_CRAWL_EMAIL || get('threads_crawl_account') || '';
  const password = process.env.THREADS_CRAWL_PASSWORD || get('threads_crawl_password') || '';
  if (!username || !password) return null;
  return { username, password };
}

async function getChromium() {
  try {
    const pw = await import('playwright');
    return pw.chromium;
  } catch {
    throw new Error('Playwright not installed. Run: npm install playwright');
  }
}

/** Parse Threads relative time labels ("3h", "2d", "5m", "Now") into an ISO timestamp. */
function relativeTimeToIso(label: string | undefined, now: number): string | undefined {
  if (!label) return undefined;
  const t = label.trim().toLowerCase();
  if (t === 'now' || t === 'just now' || t === '剛剛') return new Date(now).toISOString();
  const m = t.match(/^(\d+)\s*(s|m|h|d|w|秒|分|小時|時|天|週|週前|分鐘|小時前|天前)/);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const ms =
    /s|秒/.test(unit) ? n * 1000 :
    /m|分/.test(unit) ? n * 60_000 :
    /h|時/.test(unit) ? n * 3_600_000 :
    /d|天/.test(unit) ? n * 86_400_000 :
    /w|週/.test(unit) ? n * 604_800_000 :
    0;
  if (!ms) return undefined;
  return new Date(now - ms).toISOString();
}

/** Parse counts from button text like "讚784", "1,234", "1.2K", "3萬" into a number.
 *  The like/reply button's textContent includes the svg <title> ("讚"/"回覆"), so we
 *  match the first numeric token anywhere in the string, not just the start. */
function parseCount(raw: string | null | undefined): number {
  if (!raw) return 0;
  const s = raw.replace(/[, ]/g, '').trim();
  const m = s.match(/([\d.]+)\s*([km萬kM]?)/i);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (isNaN(n)) return 0;
  const suffix = m[2].toLowerCase();
  if (suffix === 'k') n *= 1_000;
  else if (suffix === 'm') n *= 1_000_000;
  else if (suffix === '萬') n *= 10_000;
  return Math.round(n);
}

async function ensureLoggedIn(page: import('playwright').Page): Promise<void> {
  await page.goto(THREADS_BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3000);

  // If a composer/create marker is present and no login link, assume logged in.
  const needsLogin = await page.locator('a[href="/login"]').count().catch(() => 0);
  if (!needsLogin) {
    log.info('Threads session reused (already logged in)');
    return;
  }

  const creds = getThreadsCreds();
  if (!creds) {
    throw new Error('Not logged in and no THREADS_CRAWL_EMAIL/PASSWORD (or settings threads_crawl_account) configured. Run once with PLAYWRIGHT_HEADLESS=false to log in manually.');
  }

  log.info('Logging in to Threads...');
  await page.goto(`${THREADS_BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(2000);

  const userInput = page.locator(SELECTORS.loginUsername).first();
  await userInput.waitFor({ timeout: 30_000 });
  await userInput.fill(creds.username);
  await page.locator(SELECTORS.loginPassword).first().fill(creds.password);
  await page.locator(SELECTORS.loginSubmit).first().click();

  // Wait for the login form to disappear (or a checkpoint — surfaced to the caller).
  await page.waitForTimeout(6000);
  const stillLogin = await page.locator(SELECTORS.loginPassword).count().catch(() => 0);
  if (stillLogin) {
    throw new Error('Threads login did not complete (possible 2FA/checkpoint). Run with PLAYWRIGHT_HEADLESS=false to clear it once.');
  }
  log.info('Threads login successful');
}

/**
 * Scrape the trending topics shown on the Threads search/explore page.
 * Returns a de-duplicated list of topic strings. Best-effort: returns [] if the
 * trending block isn't present (caller falls back to curated seeds).
 */
export async function scrapeTrendingTopics(page: import('playwright').Page): Promise<string[]> {
  // Threads' /search page only surfaces a single trending pill + account suggestions.
  // The real "what's hot" lives as topic tag chips (serp_type=tags) sprinkled through
  // the For You feed, so we harvest chips from both places and dedupe.
  const collectChips = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href*="serp_type=tags"], a[href*="/search?q="]'))
        .map((a) => (a.textContent || '').trim())
        .filter(Boolean),
    ).catch(() => [] as string[]);

  const topics = new Set<string>();

  // 1) /search trending pill(s)
  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await humanPause(page, 3000, 5000);
  (await collectChips()).forEach((t) => topics.add(t));

  // 2) For You feed tag chips (scroll a little to load more)
  await page.goto(`${THREADS_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await humanPause(page, 3000, 5000);
  for (let i = 0; i < 2; i++) {
    await page.mouse.wheel(0, rand(1500, 2600));
    await humanPause(page, 1200, 2400);
  }
  (await collectChips()).forEach((t) => topics.add(t));

  const list = Array.from(topics).filter((t) => t.length >= 2 && t.length <= 40);
  log.info({ count: list.length, topics: list.slice(0, 15) }, 'Scraped trending topics');
  return list.slice(0, 15);
}

/** Curated fallback seeds from settings (JSON array), used when trending scrape is empty. */
export function getCuratedSeeds(): string[] {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('trend_seed_keywords') as
      { value: string } | undefined;
    if (row) {
      const arr = JSON.parse(row.value);
      if (Array.isArray(arr)) return arr.filter((x) => typeof x === 'string');
    }
  } catch { /* not set */ }
  return [];
}

/** Niche keywords for the reply zone (settings JSON array; seeded default). Searched
 *  in FULL every scan (NOT rotated) — the niche set is small and focused. */
const NICHE_SEED_DEFAULT = [
  // AI 應用
  'AI 工具', 'AI 應用', 'vibe coding', 'claude code', 'n8n', 'AI 學習',
  // 接案
  '接案', 'AI 接案', '自由工作者',
  // 職涯
  '轉職', '職涯規劃', '求職',
  // 留學 / 英國生活 / 美國生活
  '留學', '英國生活', '美國生活',
];
export function getNicheKeywords(): string[] {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('trend_niche_keywords') as
      { value: string } | undefined;
    if (row) {
      const arr = JSON.parse(row.value);
      if (Array.isArray(arr)) return arr.filter((x) => typeof x === 'string' && x.trim());
    }
  } catch { /* not set */ }
  return NICHE_SEED_DEFAULT;
}

/**
 * Rotate a keyword list so each scan only searches a SUBSET (window = `perScanKey` setting),
 * cycling through all of them across runs. Shrinks the per-scan search footprint — fewer
 * back-to-back searches looks less scraper-like to Meta. The rotation pointer is persisted
 * in `offsetKey` and advanced each scan. Applied to BOTH seed topics and niche keywords.
 */
function rotate(all: string[], perScanKey: string, perScanDefault: number, offsetKey: string): string[] {
  if (all.length === 0) return [];
  const db = getDb();
  const get = (k: string, d: string) =>
    (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value ?? d;
  const perScan = Math.max(1, parseInt(get(perScanKey, String(perScanDefault)), 10));
  if (all.length <= perScan) return all;
  const offset = ((parseInt(get(offsetKey, '0'), 10) % all.length) + all.length) % all.length;
  const picked: string[] = [];
  for (let i = 0; i < perScan; i++) picked.push(all[(offset + i) % all.length]);
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(offsetKey, String((offset + perScan) % all.length));
  return picked;
}
const rotateSeeds = (all: string[]) => rotate(all, 'trend_topics_per_scan', 5, 'trend_topic_rotation_offset');
const rotateNiche = (all: string[]) => rotate(all, 'trend_niche_per_scan', 6, 'trend_niche_rotation_offset');

/**
 * Warm-up gate for a fresh (re-logged-in) account. While `trend_warmup_until` (an ISO date)
 * is in the future, the scan does ONLY passive For You browsing — NO keyword searches at all
 * — so a brand-new account builds normal-browsing history before it ever looks like a scraper.
 * Auto-expires: once the date passes, full crawling resumes with no further action needed.
 */
function isWarmup(): { active: boolean; until?: string } {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('trend_warmup_until') as
      { value: string } | undefined;
    const until = row?.value?.trim();
    if (!until) return { active: false };
    // Compare as date-only (local): warm-up runs THROUGH the given day.
    const active = new Date().toISOString().slice(0, 10) < until.slice(0, 10);
    return { active, until };
  } catch { return { active: false }; }
}

/** Extract whatever posts are currently rendered in the DOM (For You feed or search). */
async function extractPostsOnPage(page: import('playwright').Page, max: number): Promise<RawThreadPost[]> {
  const now = Date.now();
  const raw = await page.evaluate((maxPosts: number) => {
    const items: Array<{ text: string; likeRaw: string; replyRaw: string; timeLabel: string; permalink: string; author: string }> = [];
    // Each feed item is one top-level post; quote-posts nest inside and are handled
    // by taking the FIRST body and the LAST engagement bar within the unit.
    let units = Array.from(document.querySelectorAll('div[data-pagelet^="threads_feed_"]'));
    if (units.length === 0) units = Array.from(document.querySelectorAll('div[data-pressable-container="true"]'));
    for (const unit of units) {
      if (items.length >= maxPosts) break;
      const langEl = unit.querySelector('div[lang]');                 // post body carries lang attr
      const text = (langEl?.textContent || '').trim().slice(0, 800);
      if (text.length < 8) continue;
      const timeEl = unit.querySelector('time[datetime]');
      const timeLabel = timeEl?.getAttribute('datetime') || '';       // already ISO
      // The timestamp is wrapped in the MAIN post's permalink anchor — most reliable.
      const timeAnchor = timeEl ? timeEl.closest('a') as HTMLAnchorElement | null : null;
      const fallbackA = unit.querySelector('a[href*="/post/"]') as HTMLAnchorElement | null;
      const permalink = timeAnchor?.href || fallbackA?.href || '';
      const authorA = unit.querySelector('a[href^="/@"]') as HTMLAnchorElement | null;
      const author = (authorA?.getAttribute('href') || '').replace('/@', '').split('/')[0];
      // Counts live in a role=button next to svg[aria-label="讚"/"回覆"]. Take the LAST
      // so the outer post's bar wins over any embedded quote-post's bar.
      const likeSvgs = unit.querySelectorAll('svg[aria-label="讚"]');
      const replySvgs = unit.querySelectorAll('svg[aria-label="回覆"]');
      const likeBtn = likeSvgs.length ? likeSvgs[likeSvgs.length - 1].closest('[role="button"]') : null;
      const replyBtn = replySvgs.length ? replySvgs[replySvgs.length - 1].closest('[role="button"]') : null;
      items.push({
        text,
        likeRaw: likeBtn?.textContent || '',
        replyRaw: replyBtn?.textContent || '',
        timeLabel,
        permalink,
        author,
      });
    }
    return items;
  }, max).catch(() => [] as Array<{ text: string; likeRaw: string; replyRaw: string; timeLabel: string; permalink: string; author: string }>);

  return raw.map((p) => ({
    text: p.text,
    likeCount: parseCount(p.likeRaw),
    replyCount: parseCount(p.replyRaw),
    timestamp: /\d{4}-\d{2}-\d{2}/.test(p.timeLabel) ? p.timeLabel : relativeTimeToIso(p.timeLabel, now),
    permalink: p.permalink || undefined,
    author: p.author || undefined,
  })).filter((p) => p.text.length > 10);
}

/**
 * Scroll the "為你推薦" (For You) feed and collect what the algorithm surfaces.
 * This is the freshest signal — current, algorithm-pushed posts — and sidesteps the
 * stale evergreen results that keyword search returns. Dedupes across scrolls.
 */
export async function scrapeForYouFeed(page: import('playwright').Page, maxPosts = 30): Promise<RawThreadPost[]> {
  await page.goto(`${THREADS_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await humanPause(page, 3000, 5000);

  const seen = new Map<string, RawThreadPost>();
  for (let i = 0; i < 10 && seen.size < maxPosts; i++) {
    for (const p of await extractPostsOnPage(page, 40)) {
      seen.set(p.permalink || p.text.slice(0, 40), p);
    }
    await page.mouse.wheel(0, rand(2200, 3800));
    await humanPause(page, 1500, 3200);
  }
  const out = Array.from(seen.values());
  log.info({ posts: out.length }, 'Scraped For You feed');
  return out;
}

/** Scrape one topic's search results (used for targeted seeds like "AI應用"). */
export async function scrapeTopicPosts(
  page: import('playwright').Page,
  topic: string,
  max = 12,
  sort: 'recent' | 'top' = 'recent',
  scrolls?: number,
): Promise<RawThreadPost[]> {
  const serp = sort === 'recent' ? 'recent' : 'default';
  const url = `${SEARCH_URL}?q=${encodeURIComponent(topic)}&serp_type=${serp}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await humanPause(page, 2500, 5000);
  // Default 1-2 scrolls (anti-detection); callers can ask for a deeper crawl.
  for (let i = 0, n = scrolls ?? rand(1, 2); i < n; i++) {
    await page.mouse.wheel(0, rand(1200, 2600));
    await humanPause(page, 1200, 2800);
  }
  const out = await extractPostsOnPage(page, max);
  log.info({ topic, posts: out.length }, 'Scraped topic posts');
  return out;
}

/**
 * Open one browser context, log in, and gather a flat list of FRESH posts:
 *   1. the "為你推薦" (For You) feed — what the algorithm is pushing now
 *   2. any configured seed topics (settings `trend_seed_keywords`, e.g. "AI應用")
 * Each post is tagged with its `source`. Throws on hard failure so the caller can alert.
 */
export async function runScrape(opts: { maxPosts?: number } = {}): Promise<{ posts: RawThreadPost[]; topics: string[] }> {
  const chromium = await getChromium();
  const userDataDir = path.resolve(process.cwd(), 'data', 'threads-crawl-profile');
  fs.mkdirSync(userDataDir, { recursive: true });

  const headless = process.env.PLAYWRIGHT_HEADLESS !== 'false';
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless,
    slowMo: rand(700, 1300),              // jittered, human-ish action pacing
    viewport: { width: 1280, height: 900 },
    timeout: 60_000,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    // Drop the navigator.webdriver automation flag — the biggest bot tell.
    args: ['--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'],
  });

  const byKey = new Map<string, RawThreadPost>();
  const add = (p: RawThreadPost, source: string, niche = false) => {
    const key = p.permalink || p.text.slice(0, 40);
    const existing = byKey.get(key);
    if (existing) { if (niche) existing.niche = true; return; }
    byKey.set(key, { ...p, source, niche: niche || undefined });
  };
  await browser.addInitScript(STEALTH_INIT);   // hide automation/headless fingerprints
  const page = browser.pages()[0] || await browser.newPage();
  const topicsSearched: string[] = ['為你推薦'];

  // Between-search idle: sometimes a quick beat, occasionally a long "got distracted"
  // pause + a peek back at the home feed — breaks the uniform search→scroll→search rhythm.
  const betweenSearches = async () => {
    if (chance(0.25)) {
      // "Distraction": drift back to the feed and scroll a bit, like a real user.
      await page.goto(`${THREADS_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      await humanPause(page, 2000, 4000);
      await page.mouse.wheel(0, rand(800, 2000));
      await humanPause(page, 8000, 20000);
    } else {
      await humanPause(page, 4000, 11000);
    }
  };

  try {
    await ensureLoggedIn(page);

    // 1) For You feed — freshest, algorithm-pushed signal. (Always run; this is the most
    //    normal-human action and the backbone of warm-up.)
    for (const p of await scrapeForYouFeed(page, opts.maxPosts ?? 30)) add(p, '為你推薦');

    // Warm-up mode (fresh account): browse the feed ONLY, skip every keyword search, so a
    // brand-new account accrues normal-looking history before it ever runs a search burst.
    const warmup = isWarmup();
    if (warmup.active) {
      log.info({ until: warmup.until }, 'Warm-up mode — For You feed only, skipping all keyword searches');
      const out = Array.from(byKey.values());
      if (out.length === 0) throw new Error('Threads scrape produced no posts (not logged in or selectors stale)');
      log.info({ posts: out.length }, 'Scrape complete (warm-up)');
      return { posts: out, topics: topicsSearched };
    }

    // 2) Targeted seed topics — a rotating, shuffled subset per scan (anti-detection).
    const seeds = shuffle(rotateSeeds(getCuratedSeeds()));
    log.info({ topics: seeds }, 'Seed topics this scan (rotating subset)');
    for (let i = 0; i < seeds.length; i++) {
      // Occasionally skip a topic outright — real browsing isn't exhaustive.
      if (chance(0.1)) { log.info({ topic: seeds[i] }, 'Randomly skipped a seed topic'); continue; }
      topicsSearched.push(seeds[i]);
      try {
        for (const p of await scrapeTopicPosts(page, seeds[i], 12, 'recent')) add(p, seeds[i]);
      } catch (err) {
        log.warn({ topic: seeds[i], err: (err as Error).message }, 'Failed scraping a seed topic — continuing');
      }
      if (i < seeds.length - 1) await betweenSearches();
    }

    // 3) Niche keywords for the reply zone — now ALSO rotated + shuffled (was: full every scan,
    //    the heaviest scraper tell). Tagged niche.
    await betweenSearches();
    const niche = shuffle(rotateNiche(getNicheKeywords()));
    log.info({ niche }, 'Niche keywords this scan (rotating subset, for reply zone)');
    for (let i = 0; i < niche.length; i++) {
      if (chance(0.1)) { log.info({ keyword: niche[i] }, 'Randomly skipped a niche keyword'); continue; }
      topicsSearched.push(niche[i]);
      try {
        // Deeper crawl for the reply zone — more posts + more scrolls per keyword.
        for (const p of await scrapeTopicPosts(page, niche[i], 30, 'recent', 4)) add(p, niche[i], true);
      } catch (err) {
        log.warn({ keyword: niche[i], err: (err as Error).message }, 'Failed scraping a niche keyword — continuing');
      }
      if (i < niche.length - 1) await betweenSearches();
    }
  } finally {
    await browser.close();
  }

  const out = Array.from(byKey.values());
  if (out.length === 0) {
    throw new Error('Threads scrape produced no posts (not logged in or selectors stale)');
  }
  log.info({ posts: out.length }, 'Scrape complete');
  return { posts: out, topics: topicsSearched };
}
