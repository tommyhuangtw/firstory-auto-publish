/**
 * One-time manual Threads login for the trend crawler.
 *
 * Opens a real (headful) Chromium window using the SAME persistent profile the
 * crawler reuses (dashboard/data/threads-crawl-profile). Log in by hand with the
 * 分身 account (clear any 2FA / checkpoint), then press Enter in this terminal —
 * cookies persist to disk so scheduled scrapes won't need to log in again.
 *
 * Run from the dashboard dir:
 *   npx tsx scripts/threads-login.ts
 */
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { chromium } from 'playwright';

const THREADS_BASE = process.env.THREADS_WEB_BASE || 'https://www.threads.com';

async function main() {
  const userDataDir = path.resolve(process.cwd(), 'data', 'threads-crawl-profile');
  fs.mkdirSync(userDataDir, { recursive: true });
  console.log(`Profile dir: ${userDataDir}`);

  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'],
  });

  const page = browser.pages()[0] || await browser.newPage();
  await page.goto(`${THREADS_BASE}/login`, { waitUntil: 'domcontentloaded' });

  console.log('\n────────────────────────────────────────────');
  console.log('1. 在開啟的瀏覽器視窗用「分身帳號」登入 Threads');
  console.log('2. 如果跳出 2FA / 安全驗證，完成它');
  console.log('3. 確認看到首頁 / 動態牆後，回來這個終端機按 Enter');
  console.log('────────────────────────────────────────────\n');

  await new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('登入完成後按 Enter 關閉並儲存 session... ', () => { rl.close(); resolve(); });
  });

  // Quick check: is there still a login form on the current page?
  const stillLogin = await page.locator('input[type="password"]').count().catch(() => 0);
  if (stillLogin) {
    console.log('⚠️  目前頁面還看得到登入框 — 如果你還沒登入，請重跑一次。');
  } else {
    console.log('✅ 看起來已登入，session 已存到 profile。');
  }

  await browser.close();
  console.log('已關閉瀏覽器，cookie 已保存。');
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
