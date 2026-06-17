/**
 * One-pass DOM inspector for tuning the Threads crawler selectors.
 * Logged-in (persistent profile). Saves screenshots + a diagnostics JSON so we can
 * see the real (hashed-class) structure of the search page and a results page.
 *
 * Run: PLAYWRIGHT_HEADLESS=false npx tsx scripts/inspect-threads-dom.ts
 */
import path from 'path';
import fs from 'fs';
import { chromium } from 'playwright';

const THREADS_BASE = process.env.THREADS_WEB_BASE || 'https://www.threads.com';
const DATA = path.resolve(process.cwd(), 'data');

async function main() {
  const userDataDir = path.resolve(DATA, 'threads-crawl-profile');
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    slowMo: 600,
    viewport: { width: 1280, height: 1000 },
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    args: ['--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'],
  });
  const page = browser.pages()[0] || await browser.newPage();
  const diag: Record<string, unknown> = {};

  try {
    // ── Search / explore page ──
    await page.goto(`${THREADS_BASE}/search`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(DATA, 'threads-search.png'), fullPage: true });

    diag.searchPage = await page.evaluate(() => {
      const sample = (els: Element[], n: number) => els.slice(0, n).map((e) => ({
        tag: e.tagName.toLowerCase(),
        href: (e as HTMLAnchorElement).href || undefined,
        role: e.getAttribute('role') || undefined,
        text: (e.textContent || '').trim().slice(0, 60),
      }));
      return {
        bodyText: (document.body.innerText || '').slice(0, 1500),
        searchAnchors: sample(Array.from(document.querySelectorAll('a[href*="/search?q="]')), 30),
        pressableContainers: document.querySelectorAll('[data-pressable-container]').length,
        roleArticles: document.querySelectorAll('div[role="article"]').length,
        allArticles: document.querySelectorAll('article').length,
        // unique aria-labels present (helps find trending block / counts)
        ariaLabels: Array.from(new Set(
          Array.from(document.querySelectorAll('[aria-label]')).map((e) => e.getAttribute('aria-label') || ''),
        )).filter(Boolean).slice(0, 60),
      };
    });

    // ── A search-results page (use a broad common term) ──
    const term = process.env.TREND_TEST_TERM || 'AI';
    await page.goto(`${THREADS_BASE}/search?q=${encodeURIComponent(term)}&serp_type=default`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(4000);
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(DATA, 'threads-results.png'), fullPage: false });

    diag.resultsPage = await page.evaluate(() => {
      const postLinks = Array.from(document.querySelectorAll('a[href*="/post/"]')) as HTMLAnchorElement[];
      // Walk up from a post link to find the repeating post container.
      let containerHtml = '';
      let containerTag = '';
      if (postLinks[0]) {
        let el: HTMLElement | null = postLinks[0];
        for (let i = 0; i < 6 && el; i++) el = el.parentElement;
        if (el) { containerTag = el.tagName + (el.getAttribute('data-pressable-container') ? '[pressable]' : ''); containerHtml = el.outerHTML.slice(0, 2500); }
      }
      return {
        postLinkCount: postLinks.length,
        firstPostHrefs: postLinks.slice(0, 5).map((a) => a.href),
        pressableContainers: document.querySelectorAll('[data-pressable-container]').length,
        roleArticles: document.querySelectorAll('div[role="article"]').length,
        timeEls: document.querySelectorAll('time').length,
        firstTimeAttr: document.querySelector('time')?.getAttribute('datetime') || document.querySelector('time')?.textContent || null,
        ariaLabels: Array.from(new Set(
          Array.from(document.querySelectorAll('[aria-label]')).map((e) => e.getAttribute('aria-label') || ''),
        )).filter(Boolean).slice(0, 80),
        sampleContainerTag: containerTag,
        sampleContainerHtml: containerHtml,
      };
    });
  } finally {
    const file = path.join(DATA, 'threads-dom-diag.json');
    fs.writeFileSync(file, JSON.stringify(diag, null, 2), 'utf-8');
    console.log('saved diag →', file);
    console.log('screenshots → data/threads-search.png, data/threads-results.png');
    await browser.close();
  }
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
