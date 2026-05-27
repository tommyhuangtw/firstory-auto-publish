/**
 * SoundOn Analytics Scraper
 *
 * Automates login → CSV export for two analytics pages:
 *   1. 單集分析 (episode stats: total/7d/30d downloads per episode)
 *   2. 節目分析 (daily download trend)
 *
 * Uses the same Playwright browser session & persistent context as soundon.ts
 * so login cookies are reused across runs.
 */

import path from 'path';
import fs from 'fs';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('soundon-scraper');

const PODCAST_ID = 'ca974d36-6fcc-46fc-a339-ba7ed8902c80';
const SOUNDON_BASE = 'https://host.soundon.fm';
const LOGIN_URL = `${SOUNDON_BASE}/app/podcasts/${PODCAST_ID}/episodes`;
const EPISODES_ANALYTICS_URL = `${SOUNDON_BASE}/app/podcasts/${PODCAST_ID}/analytics/episodes`;
const HOSTING_ANALYTICS_URL = `${SOUNDON_BASE}/app/podcasts/${PODCAST_ID}/analytics/podcast/hosting`;

async function getPlaywright() {
  try {
    const pw = await import('playwright');
    return pw.chromium;
  } catch {
    throw new Error('Playwright not installed. Run: npm install playwright');
  }
}

export interface ScrapeResult {
  episodeCsv: string | null;   // raw CSV text from 單集分析
  dailyCsv: string | null;     // raw CSV text from 節目分析
  errors: string[];
}

/**
 * Main entry point — scrapes both analytics pages and returns CSV text.
 * Downloads are intercepted in-memory (no disk temp files needed).
 */
export async function scrapeSoundOnAnalytics(): Promise<ScrapeResult> {
  const email = process.env.SOUNDON_EMAIL;
  const password = process.env.SOUNDON_PASSWORD;
  if (!email || !password) {
    throw new Error('SOUNDON_EMAIL and SOUNDON_PASSWORD are required');
  }

  const chromium = await getPlaywright();
  const userDataDir = path.resolve(process.cwd(), '..', 'temp', 'browser-data');
  fs.mkdirSync(userDataDir, { recursive: true });

  const headless = process.env.PLAYWRIGHT_HEADLESS !== 'false';
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless,
    slowMo: 500,
    viewport: { width: 1920, height: 1080 },
    timeout: 60000,
    args: ['--no-first-run', '--no-default-browser-check'],
    acceptDownloads: true,
  });

  const result: ScrapeResult = { episodeCsv: null, dailyCsv: null, errors: [] };
  const page = browser.pages()[0] || await browser.newPage();

  try {
    // 1. Login (reuses session if already logged in)
    await ensureLoggedIn(page, email, password);

    // 2. Scrape 單集分析 CSV
    try {
      result.episodeCsv = await scrapeEpisodesCsv(page);
      log.info({ bytes: result.episodeCsv.length }, 'Episode CSV scraped');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg }, 'Failed to scrape episodes CSV');
      result.errors.push(`episodes: ${msg}`);
    }

    // 3. Scrape 節目分析 CSV (360d range for full year history)
    try {
      result.dailyCsv = await scrapeHostingCsv(page);
      log.info({ bytes: result.dailyCsv.length }, 'Daily CSV scraped');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg }, 'Failed to scrape hosting CSV');
      result.errors.push(`hosting: ${msg}`);
    }

  } finally {
    await browser.close();
  }

  return result;
}

// ── Login ────────────────────────────────────────────────────────────

async function ensureLoggedIn(
  page: import('playwright').Page,
  email: string,
  password: string
) {
  log.info('Navigating to SoundOn...');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  if (page.url().includes('/app/podcasts')) {
    log.info('Already logged in (session reused)');
    return;
  }

  log.info('Logging in...');
  const emailInput = page.locator('input[type="email"], input[name="email"]');
  await emailInput.waitFor({ timeout: 30000 });
  await emailInput.fill(email);

  const passwordInput = page.locator('input[type="password"], input[name="password"]');
  await passwordInput.fill(password);

  await page.locator('button[type="submit"], button:has-text("登入")').click();
  await page.waitForURL('**/app/podcasts/**', { timeout: 60000 });
  log.info('Login successful');
}

// ── 單集分析 CSV ─────────────────────────────────────────────────────

async function scrapeEpisodesCsv(page: import('playwright').Page): Promise<string> {
  log.info('Navigating to episodes analytics...');
  await page.goto(EPISODES_ANALYTICS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Wait for table to populate with real data (not "無此資料")
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('.ant-table-tbody tr');
    if (rows.length === 0) return false;
    return !rows[0].textContent?.includes('無此資料');
  }, { timeout: 30000 });
  await page.waitForTimeout(1000);

  // SoundOn builds CSV as a blob URL in the browser — intercept it
  const csvText = await page.evaluate(() => {
    return new Promise<string>((resolve, reject) => {
      const origCreateElement = document.createElement.bind(document);
      document.createElement = function(tag: string, ...rest: unknown[]) {
        const el = origCreateElement(tag, ...rest as [ElementCreationOptions]);
        if (tag.toLowerCase() === 'a') {
          const origClick = el.click.bind(el);
          (el as HTMLElement & { click: () => void }).click = async function() {
            const href = (el as HTMLAnchorElement).href;
            if (href.startsWith('blob:')) {
              try {
                const res = await fetch(href);
                const text = await res.text();
                resolve(text);
              } catch (e) {
                reject(e);
              }
              return;
            }
            origClick();
          };
        }
        return el;
      };

      // Click the CSV export button
      const btn = document.querySelector('button.ant-btn.ant-btn-primary') as HTMLButtonElement | null;
      if (!btn) {
        reject(new Error('CSV export button not found'));
        return;
      }
      btn.click();

      // Timeout fallback
      setTimeout(() => reject(new Error('Blob URL intercept timeout after 10s')), 10000);
    });
  });

  if (!csvText.trim()) throw new Error('Episode CSV is empty');
  return csvText;
}

// ── 節目分析 CSV ─────────────────────────────────────────────────────

async function scrapeHostingCsv(page: import('playwright').Page): Promise<string> {
  log.info('Navigating to hosting analytics...');
  await page.goto(HOSTING_ANALYTICS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Select 年 (360d) range to get full history
  const yearRadio = page.locator('.ant-radio-button-wrapper', { hasText: '年' });
  if (await yearRadio.count() > 0) {
    await yearRadio.click();
    await page.waitForTimeout(2000);
    log.info('Selected 年 (360d) range');
  }

  // Wait for chart data to load
  await page.waitForSelector('.ant-btn-primary:has-text("輸出成CSV")', { timeout: 30000 });
  await page.waitForTimeout(1000);

  // Same blob URL intercept pattern
  const csvText = await page.evaluate(() => {
    return new Promise<string>((resolve, reject) => {
      const origCreateElement = document.createElement.bind(document);
      document.createElement = function(tag: string, ...rest: unknown[]) {
        const el = origCreateElement(tag, ...rest as [ElementCreationOptions]);
        if (tag.toLowerCase() === 'a') {
          const origClick = el.click.bind(el);
          (el as HTMLElement & { click: () => void }).click = async function() {
            const href = (el as HTMLAnchorElement).href;
            if (href.startsWith('blob:')) {
              try {
                const res = await fetch(href);
                const text = await res.text();
                resolve(text);
              } catch (e) {
                reject(e);
              }
              return;
            }
            origClick();
          };
        }
        return el;
      };

      const btn = document.querySelector('button.ant-btn.ant-btn-primary') as HTMLButtonElement | null;
      if (!btn) {
        reject(new Error('CSV export button not found'));
        return;
      }
      btn.click();

      setTimeout(() => reject(new Error('Blob URL intercept timeout after 10s')), 10000);
    });
  });

  if (!csvText.trim()) throw new Error('Hosting CSV is empty');
  return csvText;
}

// ── Download Interceptor ─────────────────────────────────────────────

async function interceptCsvDownload(
  page: import('playwright').Page,
  buttonSelector: string
): Promise<string> {
  // Start waiting for download before clicking
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator(buttonSelector).first().click(),
  ]);

  // Read download stream into a string
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  const text = Buffer.concat(chunks).toString('utf-8');
  if (!text.trim()) {
    throw new Error('Downloaded CSV is empty');
  }
  return text;
}
