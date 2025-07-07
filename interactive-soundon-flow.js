const { SoundOnUploader } = require('./src/soundon-uploader');
const { GoogleDriveService } = require('./src/services/googleDrive');
const { AirtableService } = require('./src/services/airtable');
const { GmailService } = require('./src/services/gmail');
const { TitleSelectionServer } = require('./src/services/titleSelectionServer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
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
    
    // 4. 從 Airtable 生成候選標題
    console.log('🤖 從 Airtable 生成候選標題...');
    const candidateData = await airtable.getLatestEpisodeContent();
    
    // 使用 AI 生成多樣化的候選標題
    console.log('🎯 使用 AI 生成多樣化標題選項...');
    const candidateTitles = await generateDiverseTitles(candidateData.title, candidateData.description);
    
    // 使用 AI 選擇最佳標題
    console.log('🤖 AI 正在分析並選擇最佳標題...');
    const bestTitleIndex = await selectBestTitle(candidateTitles, candidateData.description);
    console.log(`🏆 AI 推薦的最佳標題是第 ${bestTitleIndex + 1} 個: ${candidateTitles[bestTitleIndex]}`);
    
    console.log(`✅ 生成了 ${candidateTitles.length} 個候選標題\n`);
    
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
      console.log('✅ 動態廣告選項設定成功（片頭和片中都選擇"是"）\n');
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

// 使用 Gemini AI 生成多樣化標題
async function generateDiverseTitles(originalTitle, description) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
請根據以下 Podcast 內容，生成10個吸引人的標題。標題必須包含知名AI工具或公司名稱，讓用戶有熟悉感並想要點擊。

原始標題：${originalTitle}
內容描述：${description}

標題要求：
1. 標題長度要和下方範例差不多（約20-30字），內容要有吸引力且資訊豐富。
2. 標題必須使用臺灣常用的繁體中文用語。
3. 如果內容有提到特定AI工具或產品，請務必在標題中明確寫出工具名稱。
4. 每個標題都要有明確主題、工具名稱或亮點，語氣活潑、吸睛。
5. 適合台灣年輕族群。

標題範例格式：
- Cursor CEO預言無Code未來！NanoBrowser一鍵操控太神
- Cursor + Claude：AI程式碼神器，打造未來軟體開發！
- AI自主溝通！DeepAgent驚人突破，Copilot與Claude聯手
- VEO 3超狂進化！用手機就能免費做AI影片？
- AI工具界核彈級更新！Veo 3自動剪、Suno寫歌、Gemini
- 一天做12倍事？Claude Squad拯救爆炸行程的神隊友
- AI幫你找創業題目、寫網站，還能自動除錯！這些工具太狂
- AI副業爆發中！從開店到頻道複製，每月賺50K的祕密都在這

請直接提供 10 個標題，每行一個，不要編號，不要其他說明文字。
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // 解析生成的標題
    const generatedTitles = text.split('\n')
      .map(title => title.trim())
      .filter(title => title.length > 0 && !title.match(/^\d+[\.\)]/)) // 過濾掉編號
      .slice(0, 10); // 確保只取前10個

    // 如果生成的標題不足10個，補充一些備用標題
    if (generatedTitles.length < 10) {
      const backupTitles = [
        `${originalTitle} | 深度解析`,
        `今日焦點：${originalTitle}`,
        `AI 前線報導：${originalTitle}`,
        `科技新知：${originalTitle}`,
        `數位時代：${originalTitle}`,
        `熱門話題：${originalTitle}`,
        `最新消息：${originalTitle}`,
        `科技趨勢：${originalTitle}`
      ];
      
      // 添加備用標題直到達到10個
      for (const backup of backupTitles) {
        if (generatedTitles.length >= 10) break;
        if (!generatedTitles.includes(backup)) {
          generatedTitles.push(backup);
        }
      }
    }

    console.log('🎨 AI 生成的候選標題：');
    generatedTitles.forEach((title, index) => {
      console.log(`   ${index + 1}. ${title}`);
    });

    return generatedTitles.slice(0, 10); // 確保返回10個標題

  } catch (error) {
    console.error('❌ AI 標題生成失敗:', error);
    console.log('⚠️ 使用備用標題生成方式...');
    
    // 備用方案：手動生成多樣化標題
    return [
      originalTitle,
      `${originalTitle} | 深度解析`,
      `今日焦點：${originalTitle}`,
      `AI 前線報導：${originalTitle}`,
      `科技新知：${originalTitle}`,
      `數位時代：${originalTitle}`,
      `熱門話題：${originalTitle}`,
      `最新消息：${originalTitle}`,
      `科技趨勢：${originalTitle}`,
      `創新科技：${originalTitle}`
    ];
  }
}

// 使用 AI 選擇最佳標題
async function selectBestTitle(candidateTitles, description) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
你是一個專業的 Podcast 標題評估專家。請從以下 ${candidateTitles.length} 個候選標題中選出最佳的一個。

內容描述：${description}

候選標題：
${candidateTitles.map((title, index) => `${index + 1}. ${title}`).join('\n')}

評估標準：
1. 吸引力和點擊率潛力
2. 與內容的相關性
3. SEO 友好度
4. 社交媒體分享潛力
5. 目標受眾的興趣匹配度
6. 標題的獨特性和記憶點
7. 用語需貼近台灣Podcast圈常見標題
8. 會讓AI學習者點進來的標題

請只回答最佳標題的編號（1-${candidateTitles.length}），不要其他說明。
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();
    
    // 解析AI選擇的編號
    const selectedNumber = parseInt(text.match(/\d+/)?.[0]);
    
    if (selectedNumber && selectedNumber >= 1 && selectedNumber <= candidateTitles.length) {
      return selectedNumber - 1; // 轉換為0基索引
    } else {
      console.log('⚠️ AI 選擇結果無效，使用第一個標題作為默認');
      return 0;
    }

  } catch (error) {
    console.error('❌ AI 最佳標題選擇失敗:', error);
    console.log('⚠️ 使用第一個標題作為默認最佳選擇');
    return 0; // 默認選擇第一個標題
  }
}

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