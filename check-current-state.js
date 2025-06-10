const { SoundOnUploader } = require('./src/soundon-uploader');

async function checkCurrentState() {
  const uploader = new SoundOnUploader();
  
  try {
    console.log('🔍 檢查當前瀏覽器狀態...');
    
    // 連接到瀏覽器
    await uploader.initialize();
    console.log('✅ 瀏覽器已連接');
    
    // 檢查所有打開的頁面
    const pages = uploader.browser.pages();
    console.log(`📱 發現 ${pages.length} 個頁面:`);
    
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const url = page.url();
      const title = await page.title();
      console.log(`  ${i + 1}. ${title} - ${url}`);
    }
    
    // 使用第一個頁面
    uploader.page = pages[0];
    const currentUrl = uploader.page.url();
    console.log(`📍 當前活躍頁面: ${currentUrl}`);
    
    // 如果不在 SoundOn，導航到正確頁面
    if (!currentUrl.includes('soundon.fm')) {
      console.log('🔗 導航到 SoundOn 創建頁面...');
      
      // 登入並進入創建頁面
      await uploader.login();
      await uploader.clickNewEpisode();
      
      const newUrl = uploader.page.url();
      console.log(`📍 導航後頁面: ${newUrl}`);
    }
    
    // 截圖查看當前狀態
    await uploader.page.screenshot({ path: 'temp/current-state.png' });
    console.log('📸 當前狀態截圖已保存');
    
    // 現在檢查是否已經有上傳完成的音檔
    console.log('\n🎵 檢查音檔上傳狀態...');
    
    // 查看頁面上是否有音檔文件名
    const audioNameElements = await uploader.page.$$('*');
    let foundAudio = false;
    
    for (const element of audioNameElements) {
      try {
        const text = await element.textContent();
        if (text && text.includes('daily_podcast_chinese_2025-06-10')) {
          console.log(`✅ 找到音檔: ${text.trim()}`);
          foundAudio = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    if (!foundAudio) {
      console.log('❓ 沒有找到已上傳的音檔');
    }
    
    // 檢查是否有任何上傳相關的元素
    const uploadSelectors = [
      '.ant-upload-list-item',
      '[class*="upload"]',
      '[class*="progress"]',
      '[class*="file"]'
    ];
    
    for (const selector of uploadSelectors) {
      try {
        const elements = uploader.page.locator(selector);
        const count = await elements.count();
        if (count > 0) {
          console.log(`📁 找到 ${count} 個 ${selector} 元素`);
          
          for (let i = 0; i < Math.min(count, 3); i++) {
            const element = elements.nth(i);
            const text = await element.textContent();
            const className = await element.getAttribute('class');
            console.log(`  ${i + 1}. class: "${className}" - text: "${text?.trim() || '(空)'}"`);
          }
        }
      } catch (e) {
        continue;
      }
    }
    
  } catch (error) {
    console.error('❌ 檢查失敗:', error.message);
  }
}

// 立即運行
if (require.main === module) {
  checkCurrentState()
    .then(() => {
      console.log('🎉 檢查完成');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 檢查失敗:', error.message);
      process.exit(1);
    });
}

module.exports = { checkCurrentState }; 