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
): Promise<RawThreadPost[]> {
  const serp = sort === 'recent' ? 'recent' : 'default';
  const url = `${SEARCH_URL}?q=${encodeURIComponent(topic)}&serp_type=${serp}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await humanPause(page, 2500, 5000);
  for (let i = 0, n = rand(1, 2); i < n; i++) {
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
export async function runScrape(opts: { maxPosts?: number } = {}): Promise<RawThreadPost[]> {
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
  const add = (p: RawThreadPost, source: string) => {
    const key = p.permalink || p.text.slice(0, 40);
    if (!byKey.has(key)) byKey.set(key, { ...p, source });
  };
  const page = browser.pages()[0] || await browser.newPage();

  try {
    await ensureLoggedIn(page);

    // 1) For You feed — freshest, algorithm-pushed signal.
    for (const p of await scrapeForYouFeed(page, opts.maxPosts ?? 30)) add(p, '為你推薦');

    // 2) Targeted seed topics (recency-filtered downstream).
    const seeds = getCuratedSeeds();
    for (let i = 0; i < seeds.length; i++) {
      try {
        for (const p of await scrapeTopicPosts(page, seeds[i], 12, 'recent')) add(p, seeds[i]);
      } catch (err) {
        log.warn({ topic: seeds[i], err: (err as Error).message }, 'Failed scraping a seed topic — continuing');
      }
      if (i < seeds.length - 1) await humanPause(page, 4000, 9000);
    }
  } finally {
    await browser.close();
  }

  const out = Array.from(byKey.values());
  if (out.length === 0) {
    throw new Error('Threads scrape produced no posts (not logged in or selectors stale)');
  }
  log.info({ posts: out.length }, 'Scrape complete');
  return out;
}
