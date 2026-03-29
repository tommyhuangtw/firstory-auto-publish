const { SoundOnUploader } = require('./src/soundon-uploader');
const { GoogleDriveService } = require('./src/services/googleDrive');
const { AirtableService } = require('./src/services/airtable');
const { GmailService } = require('./src/services/gmail');
const { TitleSelectionServer } = require('./src/services/titleSelectionServer');
const { ThumbnailGenerator } = require('./src/services/thumbnailGenerator');
const { VideoCreator } = require('./src/services/videoCreator');
const { YouTubeService } = require('./src/services/youtube');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const {
  SEGMENTS,
  compressImageForSoundOn,
  getNextEpisodeNumber,
  convertAudioToMp3,
  buildYouTubeDescription,
  waitForSelectionWithTimeout
} = require('./src/utils/flowHelpers');

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
        title: selectedTitleData.title.replace(/^EP\d+\s*[｜-]\s*/, ''),
        episodeNumber: nextEpisodeNumber,
        coverImagePath: coverResult.path,
        description: '每日 AI 精華，幫你降低資訊焦慮'
      });
      downloadedFilePaths.push(thumbnailPath);

      // 15. 合成影片（音檔 + 縮圖 → MP4）
      console.log('🎬 合成 YouTube 影片...');
      const videoCreator = new VideoCreator();
      const videoPath = await videoCreator.createVideoFromAudioAndImage(
        finalAudioPath,
        thumbnailPath
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

// 注意：標題生成和選擇邏輯已移至 ContentGenerator
// 共用工具函數已移至 src/utils/flowHelpers.js

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