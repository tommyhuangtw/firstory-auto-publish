/**
 * SoundOn Playwright Publisher — TypeScript port of src/soundon-uploader.js.
 *
 * Automates episode publishing to SoundOn via Playwright browser automation.
 * Requires: SOUNDON_EMAIL, SOUNDON_PASSWORD env vars.
 */

import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('soundon');

const PODCAST_ID = 'ca974d36-6fcc-46fc-a339-ba7ed8902c80';
const SOUNDON_BASE = 'https://host.soundon.fm';
const EPISODES_URL = `${SOUNDON_BASE}/app/podcasts/${PODCAST_ID}/episodes`;

// Lazy-load playwright to avoid crash if not installed
async function getPlaywright() {
  try {
    const pw = await import('playwright');
    return pw.chromium;
  } catch {
    throw new Error('Playwright is not installed. Run: npm install playwright');
  }
}

interface UploadParams {
  title: string;
  description: string;
  audioPath: string;
  coverPath?: string;
}

export async function publishToSoundOn(params: UploadParams): Promise<string> {
  const { title, description, audioPath, coverPath } = params;

  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

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
    slowMo: 1000,
    viewport: { width: 1920, height: 1080 },
    timeout: 60000,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
    ],
  });

  const page = browser.pages()[0] || await browser.newPage();

  try {
    // 1. Login
    await login(page, email, password);

    // 2. Click new episode
    await clickNewEpisode(page);

    // 3. Upload audio
    await uploadAudioFile(page, path.resolve(audioPath));

    // 4. Fill episode info
    await fillEpisodeInfo(page, title, description);

    // 5. Select episode type (public)
    await selectEpisodeType(page);

    // 6. Disable ads
    await setAdvertisementOptions(page);

    // 7. Upload cover if provided (compress first to avoid SoundOn size limits)
    if (coverPath && fs.existsSync(coverPath)) {
      const compressedCover = await compressCoverImage(path.resolve(coverPath));
      await uploadCoverImage(page, compressedCover);
    }

    // 8. Publish (first attempt)
    await clickPublish(page);

    // 9. SoundOn bug workaround: click 編輯 → publish again
    await page.waitForTimeout(3000);
    await clickEditButton(page);
    await clickPublish(page);

    // Get final URL
    const finalUrl = page.url();
    log.info({ finalUrl }, 'SoundOn publish complete');
    return finalUrl.includes('episodes') ? finalUrl : EPISODES_URL;
  } finally {
    await browser.close();
  }
}

// ── Helper functions ──

async function login(page: import('playwright').Page, email: string, password: string) {
  log.info('Logging in to SoundOn...');

  await page.goto(EPISODES_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  // Already logged in?
  if (page.url().includes('/episodes')) {
    log.info('Already logged in');
    return;
  }

  const emailInput = page.locator('input[type="email"], input[name="email"]');
  await emailInput.waitFor({ timeout: 30000 });
  await emailInput.fill(email);

  const passwordInput = page.locator('input[type="password"], input[name="password"]');
  await passwordInput.fill(password);

  const loginButton = page.locator('button[type="submit"], button:has-text("登入")');
  await loginButton.click();

  await page.waitForURL('**/episodes', { timeout: 60000 });
  log.info('Login successful');
}

async function clickNewEpisode(page: import('playwright').Page) {
  log.info('Clicking new episode...');
  const btn = page.locator('button:has-text("新增單集")');
  await btn.waitFor({ timeout: 10000 });
  await btn.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  log.info('New episode page loaded');
}

async function uploadAudioFile(page: import('playwright').Page, audioPath: string) {
  log.info({ audioPath }, 'Uploading audio file...');

  // Try setting file directly on input
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(audioPath);
  await page.waitForTimeout(3000);

  // Wait for upload to complete (max 30s)
  for (let i = 0; i < 15; i++) {
    const uploaderArea = page.locator('.so-audio-uploader__area');
    if (await uploaderArea.count() === 0) {
      log.info('Upload area disappeared — upload complete');
      return;
    }
    const text = await uploaderArea.textContent().catch(() => '');
    if (!text?.includes('將 mp3 檔案拖曳到這裡')) {
      log.info('Upload text changed — upload complete');
      return;
    }
    await page.waitForTimeout(2000);
  }
  log.warn('Upload completion check timed out, assuming complete');
}

async function fillEpisodeInfo(page: import('playwright').Page, title: string, description: string) {
  log.info('Filling episode info...');

  const titleInput = page.locator('#title, input[id="title"]');
  await titleInput.waitFor({ timeout: 10000 });
  await titleInput.clear();
  await titleInput.fill(title);

  const descEditor = page.locator('.ql-editor');
  await descEditor.waitFor({ timeout: 10000 });
  await descEditor.clear();
  await descEditor.fill(description);

  log.info('Episode info filled');
}

async function selectEpisodeType(page: import('playwright').Page) {
  log.info('Selecting episode type: public');
  const selectors = [
    'input[type="radio"][value="public"]',
    '.ant-radio-input[value="public"]',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel);
      if (await el.isVisible({ timeout: 3000 })) {
        if (!(await el.isChecked())) await el.check();
        return;
      }
    } catch { continue; }
  }
  // Fallback: click text
  try {
    await page.locator('text="一般單集"').first().click();
  } catch {
    log.warn('Could not select episode type');
  }
}

async function setAdvertisementOptions(page: import('playwright').Page) {
  log.info('Disabling ads...');
  try {
    const preAd = page.locator('#daiStatus input[type="radio"][value="inactive"]');
    await preAd.waitFor({ timeout: 5000 });
    await preAd.check();

    const midAd = page.locator('#daiMiddleStatus input[type="radio"][value="inactive"]');
    await midAd.waitFor({ timeout: 5000 });
    await midAd.check();
  } catch {
    log.warn('Could not set ad options');
  }
}

async function compressCoverImage(imagePath: string): Promise<string> {
  const stats = fs.statSync(imagePath);
  const sizeMB = stats.size / (1024 * 1024);
  log.info({ imagePath, sizeMB: sizeMB.toFixed(2) }, 'Checking cover image size');

  // If already under 500KB, no need to compress
  if (stats.size < 500 * 1024) {
    return imagePath;
  }

  const dir = path.dirname(imagePath);
  const compressedPath = path.join(dir, 'cover-compressed.jpg');

  await sharp(imagePath)
    .resize(1400, 1400, { fit: 'cover' })
    .jpeg({ quality: 85 })
    .toFile(compressedPath);

  const newStats = fs.statSync(compressedPath);
  log.info(
    { original: `${sizeMB.toFixed(2)}MB`, compressed: `${(newStats.size / (1024 * 1024)).toFixed(2)}MB` },
    'Cover image compressed for SoundOn',
  );

  return compressedPath;
}

async function uploadCoverImage(page: import('playwright').Page, imagePath: string) {
  log.info('Uploading cover image...');
  try {
    await page.locator('text="更多"').click();
    await page.waitForTimeout(2000);

    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
    await page.locator('button:has-text("上傳封面圖片")').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(imagePath);

    // Wait for crop modal to appear
    await page.waitForSelector('.ant-modal', { timeout: 15000 });
    await page.waitForTimeout(3000); // Let image load in crop tool

    // Click the blue "上傳" button in the modal footer
    const modalFooter = page.locator('.ant-modal-footer');
    const uploadConfirm = modalFooter.locator('button.ant-btn-primary').first();
    await uploadConfirm.waitFor({ state: 'visible', timeout: 10000 });
    log.info('Clicking upload confirm button in modal...');
    await uploadConfirm.click();

    // Wait for modal to fully close
    await page.waitForSelector('.ant-modal', { state: 'hidden', timeout: 30000 });
    await page.waitForTimeout(2000);
    log.info('Cover image uploaded');
  } catch (err) {
    log.warn({ error: (err as Error).message }, 'Cover image upload failed');
  }
}

async function clickEditButton(page: import('playwright').Page) {
  log.info('Clicking edit button (SoundOn bug workaround)...');
  const editBtn = page.locator('div.ant-row.ant-row-space-between.mb-md button.ant-btn.ant-btn-primary');
  try {
    await editBtn.waitFor({ state: 'visible', timeout: 15000 });
    await editBtn.click();
    await page.waitForTimeout(3000);
    log.info('Edit button clicked');
  } catch {
    log.warn('Edit button not found, skipping workaround');
  }
}

async function clickPublish(page: import('playwright').Page) {
  log.info('Publishing episode...');

  // Ensure no modal is blocking
  await page.waitForSelector('.ant-modal', { state: 'hidden', timeout: 10000 }).catch(() => {});

  // Scroll to top so the publish button in the header is visible
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);

  // Find and click publish button
  const btn = page.locator('button.ant-btn.ant-btn-primary', { hasText: '發布' }).first();
  let clicked = false;

  try {
    await btn.waitFor({ state: 'visible', timeout: 10000 });
    await btn.click();
    clicked = true;
  } catch {
    // Fallback selectors
    for (const sel of ['button:has-text("發佈")', 'button:has-text("發布")']) {
      try {
        const fb = page.locator(sel).first();
        if (await fb.isVisible({ timeout: 3000 })) {
          await fb.click();
          clicked = true;
          break;
        }
      } catch { continue; }
    }
  }

  if (!clicked) throw new Error('Could not find publish button');

  // Handle confirmation dialog
  await page.waitForTimeout(2000);
  const confirmSelectors = [
    'button:has-text("確認")',
    'button:has-text("確定")',
    '.ant-modal-footer button.ant-btn-primary',
  ];
  for (const sel of confirmSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 3000 })) {
        await btn.click();
        log.info('Clicked confirmation dialog');
        break;
      }
    } catch { continue; }
  }

  await page.waitForTimeout(3000);
  log.info('Episode published');
}
