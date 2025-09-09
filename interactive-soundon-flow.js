const { SoundOnUploader } = require('./src/soundon-uploader');
const { GoogleDriveService } = require('./src/services/googleDrive');
const { AirtableService } = require('./src/services/airtable');
const { GmailService } = require('./src/services/gmail');
const { TitleSelectionServer } = require('./src/services/titleSelectionServer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

async function runInteractiveSoundOnFlow() {
  const uploader = new SoundOnUploader();
  const googleDrive = new GoogleDriveService();
  const airtable = new AirtableService();
  const gmail = new GmailService();
  const titleServer = new TitleSelectionServer();
  
  try {
    console.log('🎙️ 開始 SoundOn 互動式自動上傳流程...\n');
    
    // 1. 初始化服務
    console.log('🔧 初始化服務...');
    await googleDrive.initializeAuth();
    await gmail.initializeAuth();
    console.log('✅ 服務初始化完成\n');
    
    // 2. 初始化並登入 SoundOn
    console.log('🔧 初始化 SoundOn Uploader...');
    await uploader.initialize();
    console.log('✅ SoundOn Uploader 初始化完成\n');
    
    console.log('🔐 登入 SoundOn...');
    const loginSuccess = await uploader.login();
    if (!loginSuccess) {
      throw new Error('SoundOn 登入失敗');
    }
    console.log('✅ SoundOn 登入成功\n');
    
    // 3. 獲取最新集數
    console.log('📊 分析現有單集，判斷下一集編號...');
    const nextEpisodeNumber = await getNextEpisodeNumber(uploader);
    console.log(`✅ 下一集編號：EP${nextEpisodeNumber}\n`);
    
    // 4. 從 Airtable 生成候選標題和描述
    console.log('🤖 從 Airtable 生成候選標題和描述...');
    const candidateData = await airtable.getLatestEpisodeContent();
    
    // 使用 Airtable 返回的標題列表和最佳標題索引
    const candidateTitles = candidateData.titles || [candidateData.title];
    const bestTitleIndex = candidateData.bestTitleIndex || 0;
    
    console.log(`✅ 獲得 ${candidateTitles.length} 個候選標題`);
    console.log('🎯 候選標題列表：');
    candidateTitles.forEach((title, index) => {
      console.log(`   ${index + 1}. ${title}`);
    });
    console.log(`🏆 AI 推薦的最佳標題是第 ${bestTitleIndex + 1} 個: ${candidateTitles[bestTitleIndex]}\n`);
    
    // 5. 為候選標題添加集數編號
    const titlesWithEpisodeNumber = candidateTitles.map(title => 
      `EP${nextEpisodeNumber} - ${title}`
    );
    
    // 6. 啟動標題選擇服務器
    console.log('🌐 啟動標題選擇服務器...');
    const serverPort = await titleServer.start();
    console.log(`✅ 標題選擇服務器已啟動在端口 ${serverPort}\n`);
    
    // 7. 發送 Gmail 確認郵件（使用帶集數的標題）
    console.log('📧 發送標題確認郵件...');
    
    // 檢查是否從Web控制台觸發，如果是則使用公網URL
    const publicUrl = process.env.WEB_CONSOLE_MODE === 'true' ? process.env.PUBLIC_URL : null;
    if (publicUrl) {
      console.log(`🌍 使用公網URL發送郵件: ${publicUrl}`);
    } else {
      console.log(`📍 使用本地URL發送郵件: http://localhost:${serverPort}`);
    }
    
    await gmail.sendTitleConfirmationEmail(titlesWithEpisodeNumber, candidateData.description, serverPort, nextEpisodeNumber, publicUrl);
    console.log('✅ 標題確認郵件已發送\n');
    
    // 8. 等待用戶選擇標題（帶超時機制）
    console.log('⏳ 等待用戶選擇標題...');
    console.log('📱 請檢查您的郵件並點擊喜歡的標題');
    console.log('⏰ 如果 2 分鐘內沒有選擇，將自動使用 AI 推薦的最佳標題');
    
    const selectedTitleData = await waitForSelectionWithTimeout(titleServer, bestTitleIndex, 120000); // 2分鐘超時
    
    // 設置實際選中的標題
    selectedTitleData.title = titlesWithEpisodeNumber[selectedTitleData.index];
    
    if (selectedTitleData.isTimeout) {
      console.log(`⏰ 超時自動選擇 AI 推薦的最佳標題: ${selectedTitleData.title}\n`);
    } else {
      console.log(`✅ 用戶選擇了標題: ${selectedTitleData.title}\n`);
    }
    
    // 9. 關閉標題選擇服務器
    await titleServer.stop();
    
    // 10. 下載 Google Drive 檔案
    console.log('📥 從 Google Drive 下載檔案...');
    
    // 下載音檔
    console.log('🎵 下載最新音檔...');
    const audioResult = await googleDrive.downloadLatestAudioFile();
    console.log(`✅ 音檔下載完成: ${audioResult.originalName}`);
    console.log(`📁 音檔路徑: ${audioResult.path}`);
    
    // 下載封面圖片
    console.log('🖼️ 下載最新封面圖片...');
    const coverResult = await googleDrive.downloadLatestCoverImage();
    console.log(`✅ 封面圖片下載完成: ${coverResult.originalName}`);
    console.log(`📁 封面圖片路徑: ${coverResult.path}\n`);
    
    // 11. 開始上傳流程
    console.log('🚀 開始上傳到 SoundOn...');
    
    const episodeData = {
      title: selectedTitleData.title, // 已經包含 EP 編號
      description: candidateData.description,
      audioPath: audioResult.path,
      coverPath: coverResult.path
    };
    
    // 上傳流程
    console.log('➕ 點擊新增單集...');
    const newEpisodeSuccess = await uploader.clickNewEpisode();
    if (!newEpisodeSuccess) {
      throw new Error('無法點擊新增單集按鈕');
    }
    console.log('✅ 進入創建單集頁面\n');
    
    console.log('🎵 上傳音檔...');
    const uploadSuccess = await uploader.uploadAudioFile(episodeData.audioPath);
    if (!uploadSuccess) {
      throw new Error('音檔上傳失敗');
    }
    console.log('✅ 音檔上傳成功\n');
    
    console.log('📝 填寫單集資訊...');
    const infoSuccess = await uploader.fillEpisodeInfo(episodeData.title, episodeData.description);
    if (!infoSuccess) {
      console.log('⚠️ 填寫單集資訊失敗，但繼續流程');
    } else {
      console.log('✅ 單集資訊填寫成功\n');
    }
    
    console.log('🎯 選擇單集類型...');
    const typeSuccess = await uploader.selectEpisodeType();
    if (!typeSuccess) {
      console.log('⚠️ 選擇單集類型失敗，但繼續流程');
    } else {
      console.log('✅ 單集類型選擇成功\n');
    }
    
    console.log('📢 設定動態廣告選項...');
    const adSuccess = await uploader.setAdvertisementOptions();
    if (!adSuccess) {
      console.log('⚠️ 設定動態廣告選項失敗，但繼續流程');
    } else {
      console.log('✅ 動態廣告選項設定成功（片頭和片中都選擇"否"）\n');
    }
    
    console.log('🖼️ 上傳封面圖片...');
    const coverSuccess = await uploader.uploadCoverImage(episodeData.coverPath);
    if (!coverSuccess) {
      console.log('⚠️ 封面圖片上傳失敗，但繼續流程');
    } else {
      console.log('✅ 封面圖片上傳成功\n');
    }
    
    console.log('🚀 發布單集...');
    const publishSuccess = await uploader.publishEpisode();
    if (!publishSuccess) {
      throw new Error('單集發布失敗');
    }
    console.log('✅ 單集發布成功\n');
    
    console.log('🎉 SoundOn 互動式自動上傳完成！');
    console.log(`📺 已成功上傳: ${episodeData.title}`);

    return {
      success: true,
      episodeTitle: episodeData.title,
      selectedIndex: selectedTitleData.index,
      episodeNumber: nextEpisodeNumber
    };
    
  } catch (error) {
    console.error('❌ 互動式 SoundOn 上傳流程失敗:', error);
    throw error;
  } finally {
    // 清理臨時文件
    try {
      const tempFiles = ['temp/daily_podcast_chinese_*', 'temp/AI懶人報用圖_*'];
      for (const pattern of tempFiles) {
        const files = require('glob').sync(pattern);
        files.forEach(file => {
          if (fs.existsSync(file)) {
            fs.unlinkSync(file);
            console.log(`🗑️ 已清理: ${file}`);
          }
        });
      }
    } catch (cleanupError) {
      console.log('⚠️ 清理臨時文件時發生錯誤:', cleanupError.message);
    }
    
    await uploader.close();
    console.log('✅ 清理完成');
  }
}

// 新增函數：獲取下一集編號
async function getNextEpisodeNumber(uploader) {
  try {
    console.log('🔍 正在分析現有單集列表...');
    
    // 嘗試從單集列表頁面解析EP編號
    try {
      // 從當前頁面導航到單集管理頁面
      console.log('🌐 導航到單集管理頁面...');
      
      // 等待頁面載入完成
      await uploader.page.waitForLoadState('networkidle');
      
      // 尋找並點擊單集管理連結
      const episodeManagementSelector = 'a[href*="/episodes"], a[href*="單集"], .menu-item:has-text("單集"), [data-testid*="episode"]';
      
      try {
        await uploader.page.waitForSelector(episodeManagementSelector, { timeout: 5000 });
        await uploader.page.click(episodeManagementSelector);
        console.log('✅ 成功點擊單集管理連結');
      } catch (clickError) {
        // 如果找不到連結，直接導航到URL
        console.log('⚠️ 找不到單集管理連結，嘗試直接導航...');
        await uploader.page.goto('https://soundon.fm/app/podcasts/ca974d36-6fcc-46fc-a339-ba7ed8902c80/episodes', { 
          waitUntil: 'networkidle',
          timeout: 30000 
        });
      }
      
      // 等待單集列表表格載入
      console.log('⏳ 等待單集列表載入...');
      await uploader.page.waitForSelector('.episode-title-link', { timeout: 15000 });
      console.log('✅ 單集列表載入完成');
      
      // 獲取所有單集標題
      const episodeTitles = await uploader.page.evaluate(() => {
        const titleLinks = document.querySelectorAll('.episode-title-link');
        return Array.from(titleLinks).map(link => link.textContent.trim());
      });
      
      console.log(`📋 找到 ${episodeTitles.length} 個單集:`);
      episodeTitles.slice(0, 5).forEach((title, index) => {
        console.log(`   ${index + 1}. ${title}`);
      });
      
      // 解析EP編號
      const episodeNumbers = [];
      episodeTitles.forEach(title => {
        const match = title.match(/^EP(\d+)/);
        if (match) {
          const epNumber = parseInt(match[1]);
          episodeNumbers.push(epNumber);
        }
      });
      
      if (episodeNumbers.length > 0) {
        // 找出最大的EP編號
        const maxEpisodeNumber = Math.max(...episodeNumbers);
        const nextEpisodeNumber = maxEpisodeNumber + 1;
        
        console.log(`📊 找到的EP編號: ${episodeNumbers.sort((a, b) => b - a).slice(0, 5).join(', ')}...`);
        console.log(`🎯 最新集數: EP${maxEpisodeNumber}`);
        console.log(`🎯 下一集將是: EP${nextEpisodeNumber}`);
        
        return nextEpisodeNumber;
      } else {
        throw new Error('無法從標題中解析出EP編號');
      }
      
    } catch (parseError) {
      console.error('❌ 自動解析集數失敗:', parseError.message);
      console.log('⚠️ 使用備用方案...');
      
      // 備用方案：基於已知信息
      console.log('📊 基於HTML顯示，最新集數應該是 EP10');
      console.log('🎯 下一集將是: EP11');
      return 11;
    }

  } catch (error) {
    console.error('❌ 獲取集數失敗:', error);
    console.log('⚠️ 無法判斷集數，將使用 EP11（基於截圖顯示的 EP10）');
    return 11; // 基於用戶截圖，我們知道最新是 EP10，所以下一集是 EP11
  }
}

// 注意：標題生成和選擇邏輯已移至 AirtableService
// 使用 OpenRouter API 統一處理所有 AI 請求

// 帶超時機制的標題選擇等待
async function waitForSelectionWithTimeout(titleServer, defaultIndex, timeoutMs) {
  return new Promise((resolve) => {
    let isResolved = false;
    
    // 設置超時
    const timeout = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        resolve({
          index: defaultIndex,
          isTimeout: true,
          timestamp: new Date()
        });
      }
    }, timeoutMs);
    
    // 等待用戶選擇
    titleServer.waitForSelection().then((selectedData) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timeout);
        resolve({
          index: selectedData.index,
          isTimeout: false,
          timestamp: selectedData.timestamp
        });
      }
    });
  });
}

// 如果直接執行此腳本
if (require.main === module) {
  runInteractiveSoundOnFlow()
    .then(result => {
      if (result.success) {
        console.log('\n🎉 互動式流程執行成功！');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`✅ 上傳標題: ${result.episodeTitle}`);
        console.log(`📺 集數編號: EP${result.episodeNumber}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        process.exit(0);
      } else {
        console.log('\n❌ 互動式流程執行失敗');
        console.log(`錯誤: ${result.error}`);
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n💥 執行過程中發生未預期的錯誤:', error);
      process.exit(1);
    });
}

module.exports = { runInteractiveSoundOnFlow };