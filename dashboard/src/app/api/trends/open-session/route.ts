import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:trends-open-session');

/**
 * Open the crawler's logged-in Chrome profile in a real (headful) window so Tommy
 * can scroll / like / follow manually to train the algorithm on the same account
 * the bot scrapes. The browser stays open until he closes the window.
 *
 * NOTE: uses the SAME persistent profile as the scraper, so it can't run while a
 * scheduled scan is mid-scrape (single-profile lock). Scans are brief + 2x/day.
 */
export async function POST() {
  const g = globalThis as unknown as { __threadsManualSession?: import('playwright').BrowserContext };
  if (g.__threadsManualSession) {
    try {
      // still connected? then it's already open
      if (g.__threadsManualSession.pages().length >= 0 && g.__threadsManualSession.browser()?.isConnected()) {
        return NextResponse.json({ opened: true, message: '視窗已經開著了' });
      }
    } catch { /* fall through and relaunch */ }
  }

  const userDataDir = path.resolve(process.cwd(), 'data', 'threads-crawl-profile');
  if (!fs.existsSync(userDataDir)) {
    return NextResponse.json({ error: '還沒登入過爬蟲帳號（找不到 profile）。先跑 scripts/threads-login.ts 登入一次。' }, { status: 400 });
  }

  try {
    const { chromium } = await import('playwright');
    const ctx = await chromium.launchPersistentContext(userDataDir, {
      headless: false,                          // always a real window, regardless of env
      viewport: null,
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei',
      args: ['--no-first-run', '--no-default-browser-check', '--start-maximized', '--disable-blink-features=AutomationControlled'],
    });
    g.__threadsManualSession = ctx;
    ctx.on('close', () => { g.__threadsManualSession = undefined; });

    const page = ctx.pages()[0] || await ctx.newPage();
    page.goto('https://www.threads.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});

    log.info('Manual Threads session opened');
    return NextResponse.json({ opened: true, message: '已開啟爬蟲 Chrome 視窗，去滑吧！關掉視窗即可。' });
  } catch (err) {
    const msg = (err as Error).message;
    log.error({ err: msg }, 'Failed to open manual session');
    // Likely causes: a scan is holding the profile lock, or no GUI session available.
    return NextResponse.json({
      error: `開啟失敗：${msg.slice(0, 160)}。可能是排程掃描正在用 profile，或無法開 GUI；可改在終端機跑 scripts/threads-login.ts。`,
    }, { status: 500 });
  }
}
