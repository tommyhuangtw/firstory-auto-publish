const { SoundOnUploader } = require('./src/soundon-uploader');
const { GoogleDriveService } = require('./src/services/googleDrive');
const { AirtableService } = require('./src/services/airtable');
const { GmailService } = require('./src/services/gmail');
const { TitleSelectionServer } = require('./src/services/titleSelectionServer');
const { ThumbnailGenerator } = require('./src/services/thumbnailGenerator');
const { VideoCreator } = require('./src/services/videoCreator');
const { YouTubeService } = require('./src/services/youtube');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// 特別單元對應表
const SEGMENTS = {
  robot: '機器人觀察週報',
  weekly: 'AI懶人精選週報'
};

// 解析 CLI 參數 --segment <type>
function parseSegmentArg() {
  const args = process.argv.slice(2);
  const segmentIdx = args.indexOf('--segment');
  if (segmentIdx !== -1 && args[segmentIdx + 1]) {
    const key = args[segmentIdx + 1];
    if (SEGMENTS[key]) {
      return SEGMENTS[key];
    }
    console.warn(`⚠️ 未知的 segment 類型: "${key}"，可用選項: ${Object.keys(SEGMENTS).join(', ')}`);
  }
  return null;
}

const segmentName = parseSegmentArg();

const MAX_COVER_SIZE = 500 * 1024; // 500KB

async function compressImageForSoundOn(imagePath) {
  const stats = fs.statSync(imagePath);
  if (stats.size <= MAX_COVER_SIZE) {
    console.log(`   檔案大小 ${(stats.size / 1024).toFixed(0)}KB，無需壓縮`);
    return imagePath;
  }

  console.log(`   原始大小: ${(stats.size / 1024).toFixed(0)}KB，開始壓縮...`);
  const targetSize = 480 * 1024; // 留 20KB buffer
  const ratio = targetSize / stats.size;
  // 將壓縮比例映射到 quality (10-90)
  const estimatedQuality = Math.max(10, Math.min(90, Math.round(ratio * 90)));

  const ext = path.extname(imagePath);
  const outputPath = imagePath.replace(ext, '_compressed.jpg');

  await sharp(imagePath)
    .resize({ width: 1400, withoutEnlargement: true })
    .jpeg({ quality: estimatedQuality })
    .toFile(outputPath);

  const newStats = fs.statSync(outputPath);
  // 邊界情況：仍超過 500KB，用更低 quality 重壓
  if (newStats.size > MAX_COVER_SIZE) {
    const retryQuality = Math.max(10, Math.round(estimatedQuality * 0.6));
    await sharp(imagePath)
      .resize({ width: 1400, withoutEnlargement: true })
      .jpeg({ quality: retryQuality })
      .toFile(outputPath);
    const finalStats = fs.statSync(outputPath);
    console.log(`   重新壓縮 (quality=${retryQuality}): ${(finalStats.size / 1024).toFixed(0)}KB`);
  } else {
    console.log(`   壓縮完成 (quality=${estimatedQuality}): ${(newStats.size / 1024).toFixed(0)}KB`);
  }

  return outputPath;
}

async function runInteractiveSoundOnFlow() {
  const uploader = new SoundOnUploader();
  const googleDrive = new GoogleDriveService();
  const airtable = new AirtableService();
  const gmail = new GmailService();
  const titleServer = new TitleSelectionServer();
  
  const downloadedFilePaths = [];
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
    const candidateData = await airtable.getLatestEpisodeContent(segmentName);
    
    // 使用 Airtable 返回的標題列表和最佳標題索引
    const candidateTitles = candidateData.titles || [candidateData.title];
    const bestTitleIndex = candidateData.bestTitleIndex || 0;
    
    console.log(`✅ 獲得 ${candidateTitles.length} 個候選標題`);
    console.log('🎯 候選標題列表：');
    candidateTitles.forEach((title, index) => {
      console.log(`   ${index + 1}. ${title}`);
    });
    console.log(`🏆 AI 推薦的最佳標題是第 ${bestTitleIndex + 1} 個: ${candidateTitles[bestTitleIndex]}\n`);
    
    // 5. 為候選標題添加集數編號（特別單元使用不同格式）
    if (segmentName) {
      console.log(`📌 特別單元模式：${segmentName}\n`);
    }
    const titlesWithEpisodeNumber = candidateTitles.map(title => {
      if (segmentName) {
        return `EP${nextEpisodeNumber} ｜ ${segmentName} - ${title}`;
      }
      return `EP${nextEpisodeNumber} - ${title}`;
    });
    
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
    
    // 8. 下載音檔並行轉換
    console.log('⏳ 在等待用戶選擇標題的同時，背景開始下載及轉檔...');
    const audioPromise = googleDrive.downloadLatestAudioFile()
      .then(audioResult => {
        console.log(`✅ 音檔下載完成: ${audioResult.originalName}`);
        console.log(`📁 音檔路徑: ${audioResult.path}`);
        downloadedFilePaths.push(audioResult.path); // 追蹤原始音檔
        return convertAudioToMp3(audioResult.path);
      })
      .then(mp3Path => {
        if (mp3Path !== downloadedFilePaths[0]) {
          downloadedFilePaths.push(mp3Path); // 追蹤轉換後的 MP3
        }
        return mp3Path;
      });

    // 9. 等待用戶選擇標題（帶超時機制）
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
    
    // 10. 關閉標題選擇服務器
    await titleServer.stop();
    
    // 11. 等待音檔處理完成
    console.log('⏳ 等待音檔處理完成...');
    const finalAudioPath = await audioPromise;
    console.log(`✅ 音檔已準備就緒: ${finalAudioPath}\n`);

    // 12. 下載封面圖片
    console.log('🖼️ 下載最新封面圖片...');
    const coverResult = await googleDrive.downloadLatestCoverImage();
    console.log(`✅ 封面圖片下載完成: ${coverResult.originalName}`);
    console.log(`📁 封面圖片路徑: ${coverResult.path}\n`);

    // 12.5 壓縮封面圖片（SoundOn 限制 500KB）
    console.log('🗜️ 檢查封面圖片大小...');
    const compressedCoverPath = await compressImageForSoundOn(coverResult.path);
    if (compressedCoverPath !== coverResult.path) {
      downloadedFilePaths.push(compressedCoverPath);
    }

    // 13. 開始上傳流程
    console.log('🚀 開始上傳到 SoundOn...');

    const episodeData = {
      title: selectedTitleData.title, // 已經包含 EP 編號
      description: candidateData.description,
      audioPath: finalAudioPath, // 使用轉換後的 MP3 路徑
      coverPath: compressedCoverPath
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
    console.log(`📺 已成功上傳: ${episodeData.title}\n`);

    // ═══════════════════════════════════════════════════
    // YouTube 發佈流程
    // ═══════════════════════════════════════════════════
    let youtubeResult = null;
    try {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📺 開始 YouTube 發佈流程...\n');

      // 14. 生成 YouTube 縮圖（預設奶油暖色風格）
      const thumbnailGen = new ThumbnailGenerator();
      const thumbnailPath = await thumbnailGen.generateDefaultThumbnail({
        title: selectedTitleData.title.replace(/^EP\d+\s*-\s*/, ''),
        episodeNumber: nextEpisodeNumber,
        coverImagePath: coverResult.path,
        description: '每日 AI 精華，幫你降低資訊焦慮'
      });
      downloadedFilePaths.push(thumbnailPath);

      // 15. 合成影片（音檔 + 封面圖 → MP4）
      console.log('🎬 合成 YouTube 影片...');
      const videoCreator = new VideoCreator();
      const videoPath = await videoCreator.createVideoFromAudioAndImage(
        finalAudioPath,
        coverResult.path
      );
      downloadedFilePaths.push(videoPath);
      console.log(`✅ 影片合成完成\n`);

      // 16. 上傳到 YouTube
      console.log('🚀 上傳到 YouTube...');
      const youtubeService = new YouTubeService();
      await youtubeService.initializeAuth();

      let youtubeTitle;
      if (segmentName) {
        // 特別單元：AI懶人報Podcast ｜ EP253 機器人觀察週報 - [標題]
        const pureTitle = selectedTitleData.title.replace(/^EP\d+\s*｜\s*/, '');
        youtubeTitle = `AI懶人報Podcast ｜ EP${nextEpisodeNumber} ${pureTitle}`;
      } else {
        youtubeTitle = `AI懶人報Podcast ｜ ${selectedTitleData.title}`;
      }
      youtubeResult = await youtubeService.uploadVideo({
        videoPath,
        title: youtubeTitle,
        description: buildYouTubeDescription(candidateData.description, candidateData.tags),
        tags: candidateData.tags,
        privacyStatus: 'public',
        thumbnailPath: thumbnailPath
      });

      console.log(`\n🎉 YouTube 上傳成功！`);
      console.log(`📺 ${youtubeResult.videoUrl}\n`);

    } catch (ytError) {
      console.error('⚠️ YouTube 發佈失敗（SoundOn 已成功）:', ytError.message);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 全部流程完成！');
    console.log(`🎙️ SoundOn: ${episodeData.title}`);
    if (youtubeResult) {
      console.log(`📺 YouTube: ${youtubeResult.videoUrl}`);
    }

    return {
      success: true,
      episodeTitle: episodeData.title,
      selectedIndex: selectedTitleData.index,
      episodeNumber: nextEpisodeNumber,
      youtubeUrl: youtubeResult?.videoUrl || null
    };
    
  } catch (error) {
    console.error('❌ 互動式 SoundOn 上傳流程失敗:', error);
    throw error;
  } finally {
    // 清理臨時文件
    try {
      // 清理音檔
      downloadedFilePaths.forEach(filePath => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`🗑️ 已清理音檔: ${filePath}`);
        }
      });

      const tempFiles = ['temp/AI懶人報用圖_*'];
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

// 新增函數：獲取下一集編號 - 改進版本，解決超時問題
async function getNextEpisodeNumber(uploader) {
  try {
    console.log('🔍 正在分析現有單集列表...');

    // 嘗試從單集列表頁面解析EP編號，使用重試機制
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`🌐 導航到單集管理頁面 (第 ${attempt} 次嘗試)...`);

        // 改進的頁面載入檢測 - 使用 domcontentloaded 替代 networkidle
        const pageLoadTimeout = parseInt(process.env.PAGE_LOAD_TIMEOUT) || 60000;
        await uploader.page.waitForLoadState('domcontentloaded', { timeout: pageLoadTimeout });
        console.log('✅ 基本頁面結構載入完成');

        // 等待一小段時間讓動態內容載入
        await uploader.page.waitForTimeout(2000);

        // 增強的單集管理連結選擇器
        const episodeManagementSelectors = [
          'a[href*="/episodes"]',
          'a[href*="單集"]',
          '.menu-item:has-text("單集")',
          '[data-testid*="episode"]',
          'nav a:has-text("單集")',
          '.ant-menu-item:has-text("單集")',
          'a:has-text("Episode")',
          'button:has-text("單集管理")'
        ];

        let navigationSuccess = false;

        // 嘗試點擊單集管理連結
        for (const selector of episodeManagementSelectors) {
          try {
            console.log(`🔍 嘗試選擇器: ${selector}`);
            const element = uploader.page.locator(selector);
            const count = await element.count();

            if (count > 0) {
              const elementWaitTimeout = parseInt(process.env.ELEMENT_WAIT_TIMEOUT) || 30000;
            const isVisible = await element.first().isVisible({ timeout: Math.min(elementWaitTimeout / 10, 3000) });
              if (isVisible) {
                await element.first().click();
                console.log(`✅ 成功點擊單集管理連結: ${selector}`);
                navigationSuccess = true;
                break;
              }
            }
          } catch (selectorError) {
            console.log(`⚠️ 選擇器失敗: ${selector}`);
            continue;
          }
        }

        // 如果無法透過連結導航，直接前往URL
        if (!navigationSuccess) {
          console.log('⚠️ 找不到單集管理連結，嘗試直接導航...');
          const navigationTimeout = parseInt(process.env.NAVIGATION_TIMEOUT) || 60000;
          await uploader.page.goto('https://soundon.fm/app/podcasts/ca974d36-6fcc-46fc-a339-ba7ed8902c80/episodes', {
            waitUntil: 'domcontentloaded',
            timeout: navigationTimeout
          });

          // 等待頁面完全載入
          await uploader.page.waitForTimeout(3000);
        }

        // 等待單集列表載入，使用多種選擇器
        console.log('⏳ 等待單集列表載入...');
        const episodeListSelectors = [
          '.episode-title-link',
          '.ant-table-tbody tr',
          '[data-testid="episode-list"]',
          '.episode-item',
          'table tr td a',
          '.episode-row'
        ];

        let episodeListFound = false;
        const elementWaitTimeout = parseInt(process.env.ELEMENT_WAIT_TIMEOUT) || 30000;
        for (const selector of episodeListSelectors) {
          try {
            await uploader.page.waitForSelector(selector, { timeout: elementWaitTimeout });
            console.log(`✅ 單集列表載入完成 (使用選擇器: ${selector})`);
            episodeListFound = true;
            break;
          } catch (listError) {
            console.log(`⚠️ 選擇器未找到: ${selector}`);
            continue;
          }
        }

        if (!episodeListFound) {
          throw new Error('無法找到單集列表');
        }

        // 等待額外時間確保內容完全載入
        await uploader.page.waitForTimeout(2000);

        // 獲取所有單集標題，使用多種方法
        let episodeTitles = [];

        // 方法1: 標準的 episode-title-link
        try {
          episodeTitles = await uploader.page.evaluate(() => {
            const titleLinks = document.querySelectorAll('.episode-title-link');
            return Array.from(titleLinks).map(link => link.textContent.trim());
          });
        } catch (e) {
          console.log('⚠️ 方法1失敗，嘗試方法2...');
        }

        // 方法2: 表格中的連結
        if (episodeTitles.length === 0) {
          try {
            episodeTitles = await uploader.page.evaluate(() => {
              const tableLinks = document.querySelectorAll('table tr td a, .ant-table-tbody tr td a');
              return Array.from(tableLinks).map(link => link.textContent.trim()).filter(text => text.includes('EP'));
            });
          } catch (e) {
            console.log('⚠️ 方法2失敗，嘗試方法3...');
          }
        }

        // 方法3: 任何包含EP的文本
        if (episodeTitles.length === 0) {
          try {
            episodeTitles = await uploader.page.evaluate(() => {
              const allElements = document.querySelectorAll('*');
              const episodeTitles = [];
              for (const element of allElements) {
                const text = element.textContent?.trim();
                if (text && text.match(/^EP\d+/)) {
                  episodeTitles.push(text);
                }
              }
              return [...new Set(episodeTitles)]; // 去重
            });
          } catch (e) {
            console.log('⚠️ 方法3也失敗了');
          }
        }

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
        console.error(`❌ 第 ${attempt} 次嘗試失敗:`, parseError.message);

        if (attempt < 3) {
          const retryDelay = (parseInt(process.env.RETRY_DELAY_BASE) || 2000) * attempt;
          console.log(`⏳ 等待 ${retryDelay / 1000} 秒後重試...`);
          await uploader.page.waitForTimeout(retryDelay);
          continue;
        } else {
          console.log('⚠️ 所有嘗試都失敗，使用備用方案...');
          break;
        }
      }
    }

    // 備用方案：基於已知信息
    console.log('📊 基於HTML顯示，最新集數應該是 EP10');
    console.log('🎯 下一集將是: EP11');
    return 11;

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

// 組合 YouTube 影片描述（SoundOn 完整描述 + YouTube 專屬尾段）
function buildYouTubeDescription(soundOnDescription, tags) {
  // 清理描述：移除 markdown **粗體**、清除行首多餘空格
  const cleaned = soundOnDescription
    .replace(/\*\*/g, '')
    .split('\n')
    .map(line => line.replace(/^[\t ]+/, ''))
    .join('\n');

  // 從 tags 生成 hashtags（取前 15 個，去空格轉為 hashtag 格式）
  const hashtags = (tags || [])
    .slice(0, 15)
    .map(t => '#' + t.replace(/\s+/g, ''))
    .join(' ');

  return cleaned
    + '\n\n---'
    + '\n🎙️ AI懶人報 Podcast — 每日 AI 精華，幫你降低資訊焦慮'
    + '\n'
    + '\n📢 收聽更多平台：'
    + '\nApple Podcast / Spotify / KKBOX'
    + '\n👉 https://portaly.cc/ailrb'
    + '\n'
    + '\n💬 合作聯繫：ailanrenbao@gmail.com'
    + '\n'
    + '\n' + hashtags;
}

async function convertAudioToMp3(audioPath) {
  console.log('🔧 開始將音檔轉換為 MP3 格式...');
  
  const originalExt = path.extname(audioPath);
  let mp3Path;
  if (originalExt) {
    mp3Path = audioPath.replace(originalExt, '.mp3');
  } else {
    mp3Path = audioPath + '.mp3';
  }
  const command = `ffmpeg -y -nostdin -i "${audioPath}" -codec:a libmp3lame -qscale:a 2 "${mp3Path}"`;

  try {
    await new Promise((resolve, reject) => {
      const process = require('child_process').exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`❌ FFmpeg 轉換失敗: ${error.message}`);
          console.error(`-- FFmpeg stderr: ${stderr}`);
          return reject(error);
        }
        console.log('✅ FFmpeg 轉換成功！');
        if (stdout) console.log(`-- FFmpeg stdout: ${stdout}`);
        resolve();
      });
    });
    
    console.log(`✅ 成功轉換音檔為 MP3: ${mp3Path}`);
    return mp3Path;
  } catch (error) {
    console.error('❌ 音檔轉換為 MP3 失敗:', error);
    throw error;
  }
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