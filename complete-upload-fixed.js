const { chromium } = require('playwright');
const path = require('path');

class CompleteUploadFixed {
  constructor() {
    this.browser = null;
    this.page = null;
    this.userDataDir = path.join(__dirname, 'temp', 'browser-data');
  }

  async initialize() {
    this.browser = await chromium.launchPersistentContext(this.userDataDir, {
      headless: false,
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
    console.log('🚀 導航到上傳頁面...');
    
    await this.page.goto('https://studio.firstory.me/dashboard');
    await this.page.waitForLoadState('networkidle');
    console.log('📍 已到達 dashboard');
    
    // 點擊 AI懶人報
    console.log('🎯 點擊 AI懶人報...');
    await this.page.click('text=AI懶人報');
    await this.page.waitForLoadState('networkidle');
    
    // 點擊上傳單集
    console.log('📤 點擊上傳單集...');
    await this.page.click('text=上傳單集');
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(3000);
    
    console.log('✅ 已進入上傳頁面');
  }

  async fillTitle() {
    console.log('✏️  填寫標題...');
    try {
      const titleInput = this.page.locator('input[type="text"]').first();
      await titleInput.fill("Claude 助你躺著賺！AI 快速打造百萬美元點子的暴富祕密，內幕大公開！");
      console.log('✅ 標題填寫完成');
      await this.page.waitForTimeout(1000);
    } catch (error) {
      console.log('❌ 標題填寫失敗:', error.message);
    }
  }

  async uploadAudio() {
    console.log('🎵 上傳音檔...');
    try {
      const audioFile = path.join(__dirname, 'temp', 'daily_podcast_chinese_2025-06-06.mp3');
      
      // 直接尋找音檔的 file input
      const fileInputs = await this.page.locator('input[type="file"]').all();
      
      for (let i = 0; i < fileInputs.length; i++) {
        const input = fileInputs[i];
        const accept = await input.getAttribute('accept');
        
        if (accept && accept.includes('audio')) {
          console.log(`🎵 使用 Input ${i + 1} 上傳音檔...`);
          await input.setInputFiles(audioFile);
          console.log('✅ 音檔上傳完成');
          await this.page.waitForTimeout(3000);
          break;
        }
      }
    } catch (error) {
      console.log('❌ 音檔上傳失敗:', error.message);
    }
  }

  async fillDescription() {
    console.log('📄 填寫描述...');
    try {
      const description = `
🔥 這一集我們要來聊聊最震撼的 AI 賺錢祕密！

💰 本集重點內容：
• YouWare 如何讓你工作效率暴增 300%
• Claude AI 的躺著賺錢攻略
• Trae AI 的暴富祕密技巧
• Cursor 編程工具的內幕大公開

🚀 你將學到：
- AI 工具的隱藏賺錢功能
- 如何利用 AI 打造被動收入
- 效率暴增的實戰技巧
- 暴富祕密的操作方法

這些 AI 工具不只是提高效率，更是你通往財富自由的關鍵！

💬 留言告訴我你最想用哪個 AI 工具來賺錢！

#AI #賺錢 #效率 #暴富 #Claude #YouWare #TraeAI #Cursor
      `.trim();
      
      const editor = this.page.locator('.ql-editor[contenteditable="true"]');
      await editor.click();
      await this.page.waitForTimeout(500);
      
      // 先選取所有文字並刪除
      console.log('🗑️  清空原有描述內容...');
      await this.page.keyboard.press('Control+a');
      await this.page.waitForTimeout(300);
      await this.page.keyboard.press('Delete');
      await this.page.waitForTimeout(500);
      
      // 然後輸入新內容
      console.log('✏️  輸入新描述內容...');
      await this.page.keyboard.type(description);
      console.log('✅ 描述填寫完成');
      await this.page.waitForTimeout(1000);
    } catch (error) {
      console.log('❌ 描述填寫失敗:', error.message);
    }
  }

  async uploadCoverImage() {
    console.log('🖼️  上傳封面圖片...');
    try {
      const coverImage = path.join(__dirname, 'temp', 'AI懶人報用圖_2025-06-06_608.png');
      
      // 先檢查是否已經有圖片上傳成功
      const existingImages = await this.page.locator('img').count();
      console.log(`📊 當前頁面圖片數量: ${existingImages}`);
      
      // 尋找圖片的 file input
      const fileInputs = await this.page.locator('input[type="file"]').all();
      
      for (let i = 0; i < fileInputs.length; i++) {
        const input = fileInputs[i];
        const accept = await input.getAttribute('accept');
        
        if (accept && accept.includes('image')) {
          console.log(`🖼️  使用 Input ${i + 1} 上傳封面...`);
          await input.setInputFiles(coverImage);
          console.log('✅ 封面圖片上傳完成');
          await this.page.waitForTimeout(3000);
          
          // 檢查圖片是否增加了
          const newImageCount = await this.page.locator('img').count();
          console.log(`📊 上傳後圖片數量: ${newImageCount}`);
          
          if (newImageCount > existingImages) {
            console.log('🎉 封面圖片上傳成功！');
            return true;
          }
          break;
        }
      }
      
      // 如果直接上傳失敗，嘗試點擊上傳區域
      try {
        console.log('🔍 嘗試點擊上傳區域...');
        const uploadArea = this.page.locator('text=選擇圖片').first();
        if (await uploadArea.isVisible({ timeout: 3000 })) {
          await uploadArea.click();
          await this.page.waitForTimeout(2000);
          
          // 重新尋找 file input
          const newFileInputs = await this.page.locator('input[type="file"]').all();
          if (newFileInputs.length > 0) {
            const imageInput = newFileInputs[newFileInputs.length - 1];
            await imageInput.setInputFiles(coverImage);
            console.log('✅ 通過點擊區域上傳成功');
            await this.page.waitForTimeout(3000);
            return true;
          }
        }
      } catch (clickError) {
        console.log('⚠️  點擊上傳區域失敗:', clickError.message);
      }
      
      return false;
    } catch (error) {
      console.log('❌ 封面上傳失敗:', error.message);
      return false;
    }
  }

  async checkUploadStatus() {
    console.log('🔍 檢查上傳狀態...');
    
    // 檢查標題
    const titleValue = await this.page.locator('input[type="text"]').first().inputValue();
    const hasTitle = titleValue && titleValue.length > 0;
    console.log(`📝 標題: ${hasTitle ? '✅' : '❌'}`);
    
    // 檢查音檔（看是否有音檔相關的元素）
    const audioElements = await this.page.locator('text=音檔').count();
    const hasAudio = audioElements > 0;
    console.log(`🎵 音檔: ${hasAudio ? '✅' : '❌'}`);
    
    // 檢查描述
    const descriptionText = await this.page.locator('.ql-editor').textContent();
    const hasDescription = descriptionText && descriptionText.trim().length > 50;
    console.log(`📄 描述: ${hasDescription ? '✅' : '❌'}`);
    
    // 檢查圖片
    const imageCount = await this.page.locator('img').count();
    const hasImage = imageCount > 0;
    console.log(`🖼️  封面: ${hasImage ? '✅' : '❌'}`);
    
    const allReady = hasTitle && hasAudio && hasDescription && hasImage;
    console.log(`\n📋 總體狀態: ${allReady ? '✅ 準備就緒' : '⚠️  還有項目需要完成'}`);
    
    return allReady;
  }

  async clickNextStep() {
    console.log('➡️  點擊下一步...');
    try {
      // 滾動到頂部確保按鈕可見
      await this.page.evaluate(() => window.scrollTo(0, 0));
      await this.page.waitForTimeout(1000);
      
      const nextButton = this.page.locator('button:has-text("下一步")');
      if (await nextButton.isVisible({ timeout: 5000 })) {
        await nextButton.click();
        await this.page.waitForLoadState('networkidle');
        console.log('✅ 成功點擊下一步');
        await this.page.waitForTimeout(3000); // 等待頁面載入
        return true;
      } else {
        console.log('❌ 找不到下一步按鈕');
        return false;
      }
    } catch (error) {
      console.log('❌ 點擊下一步失敗:', error.message);
      return false;
    }
  }

  async checkAndPublish() {
    console.log('🚀 檢查是否可以立即發佈...');
    try {
      await this.page.waitForTimeout(2000); // 等待頁面完全載入
      
      // 檢查是否有"立即發佈"按鈕
      const publishButton = this.page.locator('button:has-text("立即發佈")');
      
      if (await publishButton.isVisible({ timeout: 5000 })) {
        console.log('✅ 找到立即發佈按鈕');
        
        // 檢查按鈕是否可以點擊（未被禁用）
        const isEnabled = await publishButton.isEnabled();
        
        if (isEnabled) {
          console.log('🎉 立即發佈按鈕可以點擊，正在發佈...');
          await publishButton.click();
          await this.page.waitForLoadState('networkidle');
          console.log('🎊 Podcast 發佈成功！');
          return true;
        } else {
          console.log('⚠️  立即發佈按鈕被禁用，可能還有必填項目');
          return false;
        }
      } else {
        console.log('⚠️  找不到立即發佈按鈕，可能在其他步驟');
        
        // 檢查其他可能的發佈相關按鈕
        const altButtons = ['發佈', '完成', '提交', '送出'];
        for (const buttonText of altButtons) {
          const altButton = this.page.locator(`button:has-text("${buttonText}")`);
          if (await altButton.isVisible({ timeout: 2000 })) {
            console.log(`✅ 找到 ${buttonText} 按鈕`);
            if (await altButton.isEnabled()) {
              console.log(`🎉 點擊 ${buttonText} 按鈕...`);
              await altButton.click();
              await this.page.waitForLoadState('networkidle');
              console.log('🎊 Podcast 提交成功！');
              return true;
            }
          }
        }
        
        return false;
      }
    } catch (error) {
      console.log('❌ 發佈檢查失敗:', error.message);
      return false;
    }
  }

  async completeUpload() {
    console.log('🎯 開始完整上傳流程...');
    
    try {
      // 步驟1: 填寫標題
      await this.fillTitle();
      
      // 步驟2: 上傳音檔
      await this.uploadAudio();
      
      // 步驟3: 填寫描述
      await this.fillDescription();
      
      // 步驟4: 上傳封面圖片
      await this.uploadCoverImage();
      
      // 步驟5: 檢查所有內容是否完成
      const allReady = await this.checkUploadStatus();
      
      if (allReady) {
        console.log('🎉 所有內容已準備完成！');
        
        // 步驟6: 點擊下一步
        const nextSuccess = await this.clickNextStep();
        
        if (nextSuccess) {
          console.log('🎊 成功進入下一步！');
          
          // 步驟7: 檢查並發佈
          const publishSuccess = await this.checkAndPublish();
          
          if (publishSuccess) {
            console.log('🎉 完整上傳和發佈流程全部成功！');
            return true;
          } else {
            console.log('⚠️  上傳完成但發佈可能需要手動確認');
            return true; // 上傳成功，發佈可能需要手動
          }
        }
      } else {
        console.log('⚠️  還有內容需要完成，請檢查');
      }
      
      return false;
      
    } catch (error) {
      console.error('❌ 上傳流程失敗:', error.message);
      return false;
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

// 主執行函數
async function runCompleteUpload() {
  console.log('🚀 開始完整且正確的上傳流程...');
  
  const uploader = new CompleteUploadFixed();
  
  try {
    await uploader.initialize();
    await uploader.navigateToUploadPage();
    const success = await uploader.completeUpload();
    
    if (success) {
      console.log('🎉 完整上傳成功！瀏覽器將保持開啟 60 秒供檢查...');
      await uploader.page.waitForTimeout(60000);
    } else {
      console.log('⚠️  上傳可能未完全成功，瀏覽器將保持開啟 120 秒供手動檢查...');
      await uploader.page.waitForTimeout(120000);
    }
    
  } catch (error) {
    console.error('💥 執行失敗:', error);
  } finally {
    await uploader.close();
  }
}

// 執行
runCompleteUpload(); 