const { SoundOnUploader } = require('./src/soundon-uploader');
const { GmailService } = require('./src/services/gmail');
const { TitleSelectionServer } = require('./src/services/titleSelectionServer');
const { ThumbnailGenerator } = require('./src/services/thumbnailGenerator');
const { VideoCreator } = require('./src/services/videoCreator');
const { YouTubeService } = require('./src/services/youtube');
const { ContentGenerator } = require('./src/services/contentGenerator');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const {
  SEGMENTS,
  APPENDED_TEXT,
  APPENDED_TEXT2,
  compressImageForSoundOn,
  getNextEpisodeNumber,
  convertAudioToMp3,
  buildYouTubeDescription,
  waitForSelectionWithTimeout
} = require('./src/utils/flowHelpers');

/**
 * Phase A: 生成 AI 內容（標題候選 + 描述 + tags）
 * 同時初始化 SoundOn 取得下一集編號
 *
 * @param {Object} params
 * @param {string} params.audioPath - 音檔路徑
 * @param {string} params.coverPath - 封面圖路徑
 * @param {string} params.scriptText - 講稿/重點文字
 * @param {string|null} params.segment - 特別單元 key (robot/weekly) 或 null
 * @returns {Object} 生成結果，包含 candidateTitles, description, tags, episodeNumber 等
 */
async function generateContent({ audioPath, coverPath, scriptText, segment }) {
  const contentGenerator = new ContentGenerator();
  const uploader = new SoundOnUploader();

  try {
    console.log('🎙️ 手動上傳流程 Phase A: 生成 AI 內容...\n');

    // 驗證檔案存在
    if (!fs.existsSync(audioPath)) {
      throw new Error(`音檔不存在: ${audioPath}`);
    }
    if (!fs.existsSync(coverPath)) {
      throw new Error(`封面圖不存在: ${coverPath}`);
    }
    if (!scriptText || scriptText.trim().length === 0) {
      throw new Error('講稿/重點文字不可為空');
    }

    // 解析 segment name
    const segmentName = segment ? (SEGMENTS[segment] || null) : null;

    // 並行：AI 生成 + SoundOn 初始化取集數
    console.log('🔧 並行處理：AI 生成內容 + SoundOn 取得集數...');

    const [candidateData, episodeNumber] = await Promise.all([
      contentGenerator.generateFromText(scriptText, segmentName),
      (async () => {
        await uploader.initialize();
        const loginSuccess = await uploader.login();
        if (!loginSuccess) {
          throw new Error('SoundOn 登入失敗');
        }
        const epNum = await getNextEpisodeNumber(uploader);
        await uploader.close();
        return epNum;
      })()
    ]);

    console.log(`\n✅ AI 生成完成，共 ${candidateData.titles.length} 個候選標題`);
    console.log(`✅ 下一集編號：EP${episodeNumber}\n`);

    // 組合帶集數的標題
    const titlesWithEpisodeNumber = candidateData.titles.map(title => {
      if (segmentName) {
        return `EP${episodeNumber} ｜ ${segmentName} - ${title}`;
      }
      return `EP${episodeNumber} - ${title}`;
    });

    // 組合描述（含業配文）
    const fullDescription = APPENDED_TEXT + candidateData.description + APPENDED_TEXT2;

    return {
      candidateTitles: candidateData.titles,
      titlesWithEpisodeNumber,
      bestTitleIndex: candidateData.bestTitleIndex,
      description: fullDescription,
      rawDescription: candidateData.description,
      tags: candidateData.tags,
      episodeNumber,
      segmentName,
      audioPath,
      coverPath
    };

  } catch (error) {
    try { await uploader.close(); } catch (_) {}
    throw error;
  }
}

/**
 * Phase B: 確認後執行上傳（SoundOn + YouTube）
 *
 * @param {Object} params
 * @param {Object} params.generateResult - Phase A 的回傳結果
 * @param {string} params.editedDescription - 使用者編輯後的描述
 * @param {Function} params.onProgress - 進度回調 (step, message)
 * @returns {Object} 上傳結果
 */
async function executeUpload({ generateResult, editedDescription, onProgress }) {
  const uploader = new SoundOnUploader();
  const gmail = new GmailService();
  const titleServer = new TitleSelectionServer();
  const downloadedFilePaths = [];
  const log = (step, msg) => {
    console.log(msg);
    if (onProgress) onProgress(step, msg);
  };

  try {
    const {
      titlesWithEpisodeNumber,
      bestTitleIndex,
      tags,
      episodeNumber,
      segmentName,
      audioPath,
      coverPath
    } = generateResult;

    const description = editedDescription || generateResult.description;

    // 1. 初始化服務
    log('init', '🔧 初始化服務...');
    await gmail.initializeAuth();
    await uploader.initialize();
    const loginSuccess = await uploader.login();
    if (!loginSuccess) {
      throw new Error('SoundOn 登入失敗');
    }
    log('init', '✅ 服務初始化完成');

    // 2. 啟動標題選擇服務器 + 發送 Gmail
    log('title_selection', '🌐 啟動標題選擇服務器...');
    const serverPort = await titleServer.start();

    log('title_selection', '📧 發送標題確認郵件...');
    const publicUrl = process.env.WEB_CONSOLE_MODE === 'true' ? process.env.PUBLIC_URL : null;
    await gmail.sendTitleConfirmationEmail(titlesWithEpisodeNumber, description, serverPort, episodeNumber, publicUrl);
    log('title_selection', '✅ 標題確認郵件已發送，請前往 Gmail 選擇標題');

    // 3. 並行：等待選擇 + 處理音檔
    log('title_selection', '⏰ 等待標題選擇（2分鐘超時）...');
    const audioPromise = convertAudioToMp3(audioPath).then(mp3Path => {
      if (mp3Path !== audioPath) downloadedFilePaths.push(mp3Path);
      return mp3Path;
    });

    const selectedTitleData = await waitForSelectionWithTimeout(titleServer, bestTitleIndex, 120000);
    selectedTitleData.title = titlesWithEpisodeNumber[selectedTitleData.index];

    if (selectedTitleData.isTimeout) {
      log('title_selection', `⏰ 超時自動選擇: ${selectedTitleData.title}`);
    } else {
      log('title_selection', `✅ 用戶選擇了: ${selectedTitleData.title}`);
    }

    await titleServer.stop();

    // 4. 等待音檔處理
    const finalAudioPath = await audioPromise;
    log('processing', `✅ 音檔已準備: ${finalAudioPath}`);

    // 5. 壓縮封面圖片
    log('processing', '🗜️ 檢查封面圖片大小...');
    const compressedCoverPath = await compressImageForSoundOn(coverPath);
    if (compressedCoverPath !== coverPath) {
      downloadedFilePaths.push(compressedCoverPath);
    }

    // 6. SoundOn 上傳
    log('soundon', '🚀 開始上傳到 SoundOn...');

    log('soundon', '➕ 點擊新增單集...');
    const newEpisodeSuccess = await uploader.clickNewEpisode();
    if (!newEpisodeSuccess) throw new Error('無法點擊新增單集按鈕');

    log('soundon', '🎵 上傳音檔...');
    const uploadSuccess = await uploader.uploadAudioFile(finalAudioPath);
    if (!uploadSuccess) throw new Error('音檔上傳失敗');

    log('soundon', '📝 填寫單集資訊...');
    await uploader.fillEpisodeInfo(selectedTitleData.title, description);

    log('soundon', '🎯 選擇單集類型...');
    await uploader.selectEpisodeType();

    log('soundon', '📢 設定動態廣告選項...');
    await uploader.setAdvertisementOptions();

    log('soundon', '🖼️ 上傳封面圖片...');
    await uploader.uploadCoverImage(compressedCoverPath);

    log('soundon', '🚀 發布單集...');
    const publishSuccess = await uploader.publishEpisode();
    if (!publishSuccess) throw new Error('單集發布失敗');
    log('soundon', '✅ SoundOn 上傳成功！');

    // 7. YouTube 發佈
    let youtubeResult = null;
    try {
      log('youtube', '📺 開始 YouTube 發佈流程...');

      const thumbnailGen = new ThumbnailGenerator();
      const thumbnailPath = await thumbnailGen.generateDefaultThumbnail({
        title: selectedTitleData.title.replace(/^EP\d+\s*[｜-]\s*/, ''),
        episodeNumber,
        coverImagePath: coverPath,
        description: '每日 AI 精華，幫你降低資訊焦慮'
      });
      downloadedFilePaths.push(thumbnailPath);

      log('youtube', '🎬 合成 YouTube 影片...');
      const videoCreator = new VideoCreator();
      const videoPath = await videoCreator.createVideoFromAudioAndImage(finalAudioPath, thumbnailPath);
      downloadedFilePaths.push(videoPath);

      log('youtube', '🚀 上傳到 YouTube...');
      const youtubeService = new YouTubeService();
      await youtubeService.initializeAuth();

      let youtubeTitle;
      if (segmentName) {
        const pureTitle = selectedTitleData.title.replace(/^EP\d+\s*｜\s*/, '');
        youtubeTitle = `AI懶人報Podcast ｜ EP${episodeNumber} ${pureTitle}`;
      } else {
        youtubeTitle = `AI懶人報Podcast ｜ ${selectedTitleData.title}`;
      }

      youtubeResult = await youtubeService.uploadVideo({
        videoPath,
        title: youtubeTitle,
        description: buildYouTubeDescription(description, tags),
        tags,
        privacyStatus: 'public',
        thumbnailPath
      });

      log('youtube', `✅ YouTube 上傳成功！${youtubeResult.videoUrl}`);
    } catch (ytError) {
      log('youtube', `⚠️ YouTube 發佈失敗（SoundOn 已成功）: ${ytError.message}`);
    }

    log('done', '🎉 全部流程完成！');

    return {
      success: true,
      episodeTitle: selectedTitleData.title,
      episodeNumber,
      youtubeUrl: youtubeResult?.videoUrl || null
    };

  } catch (error) {
    console.error('❌ 手動上傳流程失敗:', error);
    throw error;
  } finally {
    // 清理臨時文件
    try {
      downloadedFilePaths.forEach(filePath => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`🗑️ 已清理: ${filePath}`);
        }
      });
    } catch (cleanupError) {
      console.log('⚠️ 清理臨時文件時發生錯誤:', cleanupError.message);
    }

    await uploader.close();
    console.log('✅ 清理完成');
  }
}

module.exports = { generateContent, executeUpload, SEGMENTS };
