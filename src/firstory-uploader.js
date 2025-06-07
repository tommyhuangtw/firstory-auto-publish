const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { Logger } = require('./utils/logger');

class FirstoryUploader {
  constructor() {
    this.logger = new Logger();
    this.browser = null;
    this.page = null;
    this.userDataDir = path.join(__dirname, '..', 'temp', 'browser-data');
    this.cookiesPath = path.join(__dirname, '..', 'temp', 'cookies.json');
  }

  async initialize() {
    // 確保目錄存在
    const tempDir = path.dirname(this.cookiesPath);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 使用持久化的 user data directory 來保持登入狀態
    this.browser = await chromium.launchPersistentContext(this.userDataDir, {
      headless: process.env.PLAYWRIGHT_HEADLESS === 'true',
      slowMo: 1000,
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei',
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--no-sandbox'
      ],
      ignoreDefaultArgs: ['--enable-automation']
    });
    
    this.page = this.browser.pages()[0] || await this.browser.newPage();
    await this.page.setViewportSize({ width: 1920, height: 1080 });
  }

  async navigateToUploadPage() {
    this.logger.info('🚀 導航到上傳頁面...');
    
    await this.page.goto('https://studio.firstory.me/dashboard');
    await this.page.waitForLoadState('networkidle');
    this.logger.info('📍 已到達 dashboard');
    
    // 點擊 AI懶人報
    this.logger.info('🎯 點擊 AI懶人報...');
    await this.page.click('text=AI懶人報');
    await this.page.waitForLoadState('networkidle');
    
    // 點擊上傳單集
    this.logger.info('📤 點擊上傳單集...');
    await this.page.click('text=上傳單集');
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(3000);
    
    this.logger.info('✅ 已進入上傳頁面');
  }

  async fillTitle(title) {
    this.logger.info('✏️  填寫標題...');
    try {
      const titleInput = this.page.locator('input[type="text"]').first();
      await titleInput.fill(title);
      this.logger.info('✅ 標題填寫完成');
      await this.page.waitForTimeout(1000);
    } catch (error) {
      this.logger.error('❌ 標題填寫失敗:', error.message);
      throw error;
    }
  }

  async uploadAudio(audioPath) {
    this.logger.info('🎵 上傳音檔...');
    try {
      // 直接尋找音檔的 file input
      const fileInputs = await this.page.locator('input[type="file"]').all();
      
      for (let i = 0; i < fileInputs.length; i++) {
        const input = fileInputs[i];
        const accept = await input.getAttribute('accept');
        
        if (accept && accept.includes('audio')) {
          this.logger.info(`🎵 使用 Input ${i + 1} 上傳音檔...`);
          await input.setInputFiles(audioPath);
          this.logger.info('✅ 音檔上傳完成');
          await this.page.waitForTimeout(3000);
          return true;
        }
      }
      
      this.logger.error('❌ 找不到音檔上傳元素');
      return false;
    } catch (error) {
      this.logger.error('❌ 音檔上傳失敗:', error.message);
      throw error;
    }
  }

  async fillDescription(description) {
    this.logger.info('📄 填寫描述...');
    try {
      const editor = this.page.locator('.ql-editor[contenteditable="true"]');
      await editor.click();
      await this.page.waitForTimeout(500);
      
      // 先選取所有文字並刪除
      this.logger.info('🗑️  清空原有描述內容...');
      await this.page.keyboard.press('Control+a');
      await this.page.waitForTimeout(300);
      await this.page.keyboard.press('Delete');
      await this.page.waitForTimeout(500);
      
      // 然後輸入新內容
      this.logger.info('✏️  輸入新描述內容...');
      await this.page.keyboard.type(description);
      this.logger.info('✅ 描述填寫完成');
      await this.page.waitForTimeout(1000);
    } catch (error) {
      this.logger.error('❌ 描述填寫失敗:', error.message);
      throw error;
    }
  }

  async uploadCoverImage(coverPath) {
    this.logger.info('🖼️  上傳封面圖片...');
    try {
      // 先檢查是否已經有圖片上傳成功
      const existingImages = await this.page.locator('img').count();
      this.logger.info(`📊 當前頁面圖片數量: ${existingImages}`);
      
      // 尋找圖片的 file input
      const fileInputs = await this.page.locator('input[type="file"]').all();
      
      for (let i = 0; i < fileInputs.length; i++) {
        const input = fileInputs[i];
        const accept = await input.getAttribute('accept');
        
        if (accept && accept.includes('image')) {
          this.logger.info(`🖼️  使用 Input ${i + 1} 上傳封面...`);
          await input.setInputFiles(coverPath);
          this.logger.info('✅ 封面圖片上傳完成');
          await this.page.waitForTimeout(3000);
          
          // 檢查圖片是否增加了
          const newImageCount = await this.page.locator('img').count();
          this.logger.info(`📊 上傳後圖片數量: ${newImageCount}`);
          
          if (newImageCount > existingImages) {
            this.logger.info('🎉 封面圖片上傳成功！');
            return true;
          }
          break;
        }
      }
      
      // 如果直接上傳失敗，嘗試點擊上傳區域
      try {
        this.logger.info('🔍 嘗試點擊上傳區域...');
        const uploadArea = this.page.locator('text=選擇圖片').first();
        if (await uploadArea.isVisible({ timeout: 3000 })) {
          await uploadArea.click();
          await this.page.waitForTimeout(2000);
          
          // 重新尋找 file input
          const newFileInputs = await this.page.locator('input[type="file"]').all();
          if (newFileInputs.length > 0) {
            const imageInput = newFileInputs[newFileInputs.length - 1];
            await imageInput.setInputFiles(coverPath);
            this.logger.info('✅ 通過點擊區域上傳成功');
            await this.page.waitForTimeout(3000);
            return true;
          }
        }
      } catch (clickError) {
        this.logger.warn('⚠️  點擊上傳區域失敗:', clickError.message);
      }
      
      return false;
    } catch (error) {
      this.logger.error('❌ 封面上傳失敗:', error.message);
      throw error;
    }
  }

  async checkUploadStatus() {
    this.logger.info('🔍 檢查上傳狀態...');
    
    // 檢查標題
    const titleValue = await this.page.locator('input[type="text"]').first().inputValue();
    const hasTitle = titleValue && titleValue.length > 0;
    this.logger.info(`📝 標題: ${hasTitle ? '✅' : '❌'}`);
    
    // 檢查音檔（看是否有音檔相關的元素）
    const audioElements = await this.page.locator('text=音檔').count();
    const hasAudio = audioElements > 0;
    this.logger.info(`🎵 音檔: ${hasAudio ? '✅' : '❌'}`);
    
    // 檢查描述
    const descriptionText = await this.page.locator('.ql-editor').textContent();
    const hasDescription = descriptionText && descriptionText.trim().length > 50;
    this.logger.info(`📄 描述: ${hasDescription ? '✅' : '❌'}`);
    
    // 檢查圖片
    const imageCount = await this.page.locator('img').count();
    const hasImage = imageCount > 0;
    this.logger.info(`🖼️  封面: ${hasImage ? '✅' : '❌'}`);
    
    const allReady = hasTitle && hasAudio && hasDescription && hasImage;
    this.logger.info(`📋 總體狀態: ${allReady ? '✅ 準備就緒' : '⚠️  還有項目需要完成'}`);
    
    return allReady;
  }

  async clickNextStep() {
    this.logger.info('➡️  點擊下一步...');
    try {
      // 滾動到頂部確保按鈕可見
      await this.page.evaluate(() => window.scrollTo(0, 0));
      await this.page.waitForTimeout(1000);
      
      const nextButton = this.page.locator('button:has-text("下一步")');
      if (await nextButton.isVisible({ timeout: 5000 })) {
        await nextButton.click();
        await this.page.waitForLoadState('networkidle');
        this.logger.info('✅ 成功點擊下一步');
        await this.page.waitForTimeout(3000); // 等待頁面載入
        return true;
      } else {
        this.logger.error('❌ 找不到下一步按鈕');
        return false;
      }
    } catch (error) {
      this.logger.error('❌ 點擊下一步失敗:', error.message);
      throw error;
    }
  }

  async checkAndPublish() {
    this.logger.info('🚀 檢查是否可以立即發佈...');
    try {
      await this.page.waitForTimeout(2000); // 等待頁面完全載入
      
      // 檢查是否有"立即發佈"按鈕
      const publishButton = this.page.locator('button:has-text("立即發佈")');
      
      if (await publishButton.isVisible({ timeout: 5000 })) {
        this.logger.info('✅ 找到立即發佈按鈕');
        
        // 檢查按鈕是否可以點擊（未被禁用）
        const isEnabled = await publishButton.isEnabled();
        
        if (isEnabled) {
          this.logger.info('🎉 立即發佈按鈕可以點擊，正在發佈...');
          await publishButton.click();
          await this.page.waitForLoadState('networkidle');
          this.logger.info('🎊 Podcast 發佈成功！');
          return true;
        } else {
          this.logger.warn('⚠️  立即發佈按鈕被禁用，可能還有必填項目');
          return false;
        }
      } else {
        this.logger.warn('⚠️  找不到立即發佈按鈕，可能在其他步驟');
        
        // 檢查其他可能的發佈相關按鈕
        const altButtons = ['發佈', '完成', '提交', '送出'];
        for (const buttonText of altButtons) {
          const altButton = this.page.locator(`button:has-text("${buttonText}")`);
          if (await altButton.isVisible({ timeout: 2000 })) {
            this.logger.info(`✅ 找到 ${buttonText} 按鈕`);
            if (await altButton.isEnabled()) {
              this.logger.info(`🎉 點擊 ${buttonText} 按鈕...`);
              await altButton.click();
              await this.page.waitForLoadState('networkidle');
              this.logger.info('🎊 Podcast 提交成功！');
              return true;
            }
          }
        }
        
        return false;
      }
    } catch (error) {
      this.logger.error('❌ 發佈檢查失敗:', error.message);
      throw error;
    }
  }

  async uploadEpisode({ title, description, audioPath, coverPath }) {
    try {
      this.logger.info('🎯 開始完整上傳流程...');
      
      // 初始化瀏覽器
      await this.initialize();
      
      // 導航到上傳頁面
      await this.navigateToUploadPage();
      
      // 步驟1: 填寫標題
      await this.fillTitle(title);
      
      // 步驟2: 上傳音檔
      await this.uploadAudio(audioPath);
      
      // 步驟3: 填寫描述
      await this.fillDescription(description);
      
      // 步驟4: 上傳封面圖片
      if (coverPath) {
        await this.uploadCoverImage(coverPath);
      }
      
      // 步驟5: 檢查所有內容是否完成
      const allReady = await this.checkUploadStatus();
      
      if (allReady) {
        this.logger.info('🎉 所有內容已準備完成！');
        
        // 步驟6: 點擊下一步
        const nextSuccess = await this.clickNextStep();
        
        if (nextSuccess) {
          this.logger.info('🎊 成功進入下一步！');
          
          // 步驟7: 檢查並發佈
          const publishSuccess = await this.checkAndPublish();
          
          if (publishSuccess) {
            this.logger.info('🎉 完整上傳和發佈流程全部成功！');
            return { success: true };
          } else {
            this.logger.warn('⚠️  上傳完成但發佈可能需要手動確認');
            return { success: true, warning: '發佈可能需要手動確認' };
          }
        } else {
          throw new Error('點擊下一步失敗');
        }
      } else {
        throw new Error('上傳狀態檢查失敗，還有項目需要完成');
      }
      
    } catch (error) {
      this.logger.error('❌ 上傳流程失敗:', error.message);
      return { success: false, error: error.message };
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}

module.exports = { FirstoryUploader };