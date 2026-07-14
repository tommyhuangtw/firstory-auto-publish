/**
 * Interactive Threads re-login for the trend crawler — headful, NO terminal input.
 *
 * Opens a real Chromium window on the SAME persistent profile the crawler reuses
 * (dashboard/data/threads-crawl-profile). Log in by hand with the new account, clear
 * any 2FA/checkpoint, then just CLOSE the browser window — the session persists to
 * disk live, so the script exits on window-close (safe to launch in the background;
 * it never blocks on stdin like scripts/threads-login.ts does).
 *
 * Run from the dashboard dir:
 *   npx tsx scripts/threads-relogin.ts
 */
import path from 'path';
import fs from 'fs';
import { chromium } from 'playwright';

const THREADS_BASE = process.env.THREADS_WEB_BASE || 'https://www.threads.com';

async function main() {
  const userDataDir = path.resolve(process.cwd(), 'data', 'threads-crawl-profile');
  fs.mkdirSync(userDataDir, { recursive: true });
  console.log(`Profile dir: ${userDataDir}`);

  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    args: ['--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'],
  });

  const page = browser.pages()[0] || await browser.newPage();
  await page.goto(`${THREADS_BASE}/login`, { waitUntil: 'domcontentloaded' }).catch(() => {});

  console.log('\n────────────────────────────────────────────');
  console.log('1. 在開啟的瀏覽器視窗用【新帳號】登入 Threads');
  console.log('2. 如果跳出 2FA / 安全驗證，完成它');
  console.log('3. 看到首頁 / 動態牆後，直接【關掉瀏覽器視窗】即可 — session 會自動存檔');
  console.log('────────────────────────────────────────────\n');

  // Persist as they browse; resolve when the window is closed (context 'close'),
  // with a 20-min hard cap so a forgotten window can't hang forever.
  await new Promise<void>((resolve) => {
    browser.on('close', () => resolve());
    setTimeout(() => resolve(), 20 * 60_000);
  });

  // If we hit the cap while still open, verify + close cleanly.
  try {
    const stillLogin = await page.locator('input[type="password"]').count().catch(() => 0);
    console.log(stillLogin ? '⚠️  還看得到登入框 — 可能沒登入成功，重跑一次。' : '✅ 已登入，session 已存到 profile。');
    await browser.close();
  } catch { /* context already closed by the user — session already saved */ }
  console.log('已結束，cookie 已保存。');
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
