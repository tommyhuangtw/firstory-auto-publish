const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs-extra');
const { Logger } = require('./utils/logger');

class PodcastUploader {
  constructor() {
    this.logger = new Logger();
    this.browser = null;
    this.page = null;
  }

  async initialize() {
    this.browser = await chromium.launch({
      headless: process.env.HEADLESS === 'true',
      slowMo: 1000 // 放慢操作速度，避免被檢測
    });
    
    this.page = await this.browser.newPage();
    await this.page.setViewportSize({ width: 1920, height: 1080 });
    
    // 設定 User Agent 和其他 headers
    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
    });
  }

  async login() {    try {
      this.logger.info('開始登入 Firstory...');
      
      await this.page.goto('https://firstory.me/login');
      await this.page.waitForLoadState('networkidle');

      // 填寫登入資訊
      await this.page.fill('input[type="email"]', process.env.FIRSTORY_EMAIL);
      await this.page.fill('input[type="password"]', process.env.FIRSTORY_PASSWORD);
      
      // 點擊登入按鈕
      await this.page.click('button[type="submit"]');
      await this.page.waitForLoadState('networkidle');
      
      // 檢查是否登入成功
      const isLoggedIn = await this.page.locator('.user-menu, .dashboard').isVisible();
      if (!isLoggedIn) {
        throw new Error('登入失敗');
      }
      
      this.logger.info('登入成功');
      return true;
    } catch (error) {
      this.logger.error('登入失敗:', error);
      return false;
    }
  }  async uploadEpisode({ title, description, audioPath, coverPath, episodeData }) {
    try {
      await this.initialize();
      
      const loginSuccess = await this.login();
      if (!loginSuccess) {
        return { success: false, error: '登入失敗' };
      }

      // 導航到上傳頁面
      await this.page.goto('https://firstory.me/dashboard');
      await this.page.waitForLoadState('networkidle');

      // 點擊"上傳單集"按鈕
      await this.page.click('text=上傳單集');
      await this.page.waitForLoadState('networkidle');

      // 填寫標題
      await this.page.fill('input[placeholder*="標題"], input[name*="title"]', title);
      
      // 上傳音檔
      const audioInput = this.page.locator('input[type="file"][accept*="audio"]');
      await audioInput.setInputFiles(audioPath);
      
      // 等待音檔上傳完成
      await this.page.waitForTimeout(5000);
      
      return { success: true };
    } catch (error) {
      this.logger.error('上傳失敗:', error);
      return { success: false, error: error.message };
    } finally {
      if (this.browser) {
        await this.browser.close();
      }
    }
  }  async fillDescription(description) {
    // 嘗試不同的選擇器來找到描述欄位
    const descriptionSelectors = [
      'textarea[placeholder*="描述"]',
      'textarea[name*="description"]',
      '.ql-editor', // Quill editor
      'div[contenteditable="true"]'
    ];

    for (const selector of descriptionSelectors) {
      try {
        const element = this.page.locator(selector);
        if (await element.isVisible()) {
          await element.fill(description);
          break;
        }
      } catch (e) {
        continue;
      }
    }
  }

  async uploadCoverImage(coverPath) {
    try {
      const imageInput = this.page.locator('input[type="file"][accept*="image"]');
      await imageInput.setInputFiles(coverPath);
      await this.page.waitForTimeout(3000); // 等待圖片上傳
    } catch (error) {
      this.logger.error('封面上傳失敗:', error);
    }
  }
}

module.exports = { PodcastUploader };