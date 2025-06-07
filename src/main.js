const cron = require('node-cron');
const { FirstoryUploader } = require('./firstory-uploader');
const { AirtableService } = require('./services/airtable');
const { GoogleDriveService } = require('./services/googleDrive');
const { GoogleDriveAPIService } = require('./services/googleDriveAPI');
const { LLMService } = require('./services/llm');
const { Logger } = require('./utils/logger');
const path = require('path');
const fs = require('fs');

require('dotenv').config();

class PodcastAutomation {
  constructor() {
    this.uploader = new FirstoryUploader();
    this.airtable = new AirtableService();
    this.googleDrive = new GoogleDriveService();
    this.googleDriveAPI = new GoogleDriveAPIService();
    this.llm = new LLMService();
    this.logger = new Logger();
    this.tempDir = path.join(__dirname, '..', 'temp');
    
    // Google Drive 文件夾 URL
    this.audioFolderUrl = 'https://drive.google.com/drive/folders/1pB2PaU9BAKi0IGbIgudUEm29bgPhX1jq?usp=sharing';
    this.imageFolderUrl = 'https://drive.google.com/drive/folders/1BCSiZXS8aGnMdOnfJfAbwgitFfliVbQ-?usp=drive_link';
  }

  async ensureTempDirectory() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
      this.logger.info('創建 temp 目錄');
    }
  }

  // 使用 Google Drive API 下載最新檔案
  async downloadLatestFilesWithAPI() {
    try {
      this.logger.info('🔑 使用 Google Drive API 下載最新檔案...');
      
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      
      if (!clientId || !clientSecret) {
        throw new Error('找不到 GOOGLE_CLIENT_ID 或 GOOGLE_CLIENT_SECRET 環境變數');
      }
      
      // 使用 API 下載最新檔案
      const result = await this.googleDriveAPI.downloadLatestFiles(
        this.audioFolderUrl,
        this.imageFolderUrl,
        clientId,
        clientSecret
      );
      
      this.logger.info(`🎵 下載音檔: ${result.audio?.fileName}`);
      this.logger.info(`🖼️  下載圖片: ${result.image?.fileName}`);
      
      return {
        audioPath: result.audio?.path,
        imagePath: result.image?.path,
        audioFileName: result.audio?.fileName,
        imageFileName: result.image?.fileName
      };
      
    } catch (error) {
      this.logger.error('Google Drive API 下載失敗:', error.message);
      throw error;
    }
  }

  async processNextEpisode() {
    try {
      this.logger.info('🚀 開始處理下一集 Podcast...');
      
      // 確保 temp 目錄存在
      await this.ensureTempDirectory();
      
      // 1. 從 Airtable 獲取待上傳的 Podcast 資料
      this.logger.info('📊 從 Airtable 獲取待上傳資料...');
      const episodeData = await this.airtable.getNextEpisodeToUpload();
      if (!episodeData) {
        this.logger.info('沒有待上傳的 Podcast 集數');
        return;
      }

      this.logger.info(`📝 準備處理集數: ${episodeData.title || '未命名'}`);

      // 2. 從 Google Drive 下載最新的音檔和封面
      this.logger.info('📁 從 Google Drive 下載檔案...');
      
      let audioPath, coverPath, audioFileName, coverFileName;
      
      // 優先嘗試使用 Google Drive API
      const hasAPICredentials = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET;
      
      if (hasAPICredentials) {
        try {
          this.logger.info('🔑 使用 Google Drive API 方式...');
          const apiResult = await this.downloadLatestFilesWithAPI();
          
          audioPath = apiResult.audioPath;
          coverPath = apiResult.imagePath;
          audioFileName = apiResult.audioFileName;
          coverFileName = apiResult.imageFileName;
          
          this.logger.info('✅ Google Drive API 下載成功');
          
        } catch (apiError) {
          this.logger.warn('Google Drive API 失敗，回退到 JSON 檔案方式:', apiError.message);
          
          if (apiError.message.includes('需要完成 OAuth 認證流程')) {
            this.logger.info('💡 請先執行 OAuth 認證: npm run download-api');
            throw new Error('需要完成 Google Drive OAuth 認證。請執行: npm run download-api');
          }
          
          // 回退到原有方式
          const fallbackResult = await this.useJSONFallback();
          audioPath = fallbackResult.audioPath;
          coverPath = fallbackResult.coverPath;
          audioFileName = fallbackResult.audioFileName;
          coverFileName = fallbackResult.coverFileName;
        }
      } else {
        this.logger.info('📋 使用 JSON 檔案方式...');
        const fallbackResult = await this.useJSONFallback();
        audioPath = fallbackResult.audioPath;
        coverPath = fallbackResult.coverPath;
        audioFileName = fallbackResult.audioFileName;
        coverFileName = fallbackResult.coverFileName;
      }

      // 確保檔案有正確的副檔名
      audioPath = await this.ensureFileExtension(audioPath, '.mp3');
      coverPath = await this.ensureFileExtension(coverPath, '.png');

      // 3. 使用 LLM 生成標題和描述
      this.logger.info('🤖 使用 LLM 生成標題和描述...');
      const content = await this.llm.generateEpisodeContent(episodeData);
      
      this.logger.info(`📝 生成的標題: ${content.title}`);
      this.logger.info(`📄 生成的描述長度: ${content.description.length} 字`);
      
      // 顯示所有候選標題
      if (content.titleCandidates && content.titleCandidates.length > 0) {
        this.logger.info('💡 所有候選標題:');
        content.titleCandidates.forEach((title, index) => {
          this.logger.info(`  ${index + 1}. ${title}`);
        });
      }

      // 4. 上傳到 Firstory
      this.logger.info('🚀 開始上傳到 Firstory...');
      const uploadResult = await this.uploader.uploadEpisode({
        title: content.title,
        description: content.description,
        audioPath: audioPath,
        coverPath: coverPath,
        episodeData
      });

      if (uploadResult.success) {
        // 5. 更新 Airtable 狀態
        this.logger.info('📊 更新 Airtable 狀態...');
        
        await this.airtable.markEpisodeAsUploaded(episodeData.id, {
          uploadedTitle: content.title,
          uploadedDescription: content.description,
          audioFile: audioFileName || path.basename(audioPath),
          coverFile: coverFileName || path.basename(coverPath),
          uploadTime: new Date().toISOString()
        });
        
        this.logger.info('🎉 Podcast 上傳成功！');
        
        if (uploadResult.warning) {
          this.logger.warn(`⚠️  警告: ${uploadResult.warning}`);
        }
        
        return {
          success: true,
          episodeTitle: content.title,
          warning: uploadResult.warning
        };
      } else {
        throw new Error(uploadResult.error);
      }

    } catch (error) {
      this.logger.error('💥 處理 Podcast 時發生錯誤:', error);
      
      // 可以在這裡添加錯誤通知邏輯，比如發送到 Slack 或 Email
      await this.handleError(error);
      
      throw error;
    } finally {
      // 確保關閉瀏覽器
      try {
        await this.uploader.close();
      } catch (closeError) {
        this.logger.warn('關閉瀏覽器時發生錯誤:', closeError.message);
      }
    }
  }

  // 回退到使用 JSON 檔案和舊版 Google Drive 服務
  async useJSONFallback() {
    try {
      // 先嘗試從 JSON 檔案讀取路徑
      const filePaths = await this.googleDrive.getLatestFilePaths();
      
      if (filePaths.audioPath && filePaths.imagePath) {
        this.logger.info('📖 使用 JSON 檔案中的路徑');
        this.logger.info(`🎵 音檔路徑: ${filePaths.audioPath}`);
        this.logger.info(`🖼️  封面路徑: ${filePaths.imagePath}`);
        this.logger.info(`⏰ 最後更新: ${filePaths.lastUpdated}`);
        
        return {
          audioPath: filePaths.audioPath,
          coverPath: filePaths.imagePath,
          audioFileName: path.basename(filePaths.audioPath),
          coverFileName: path.basename(filePaths.imagePath)
        };
      } else {
        throw new Error('JSON 檔案中缺少檔案路徑');
      }
    } catch (jsonError) {
      this.logger.warn('無法從 JSON 檔案讀取路徑，嘗試從環境變數下載:', jsonError.message);
      
      // 如果 JSON 檔案不存在或無效，嘗試從環境變數下載
      const audioResult = await this.googleDrive.downloadLatestAudioFile();
      const coverResult = await this.googleDrive.downloadLatestCoverImage();
      
      this.logger.info(`🎵 音檔: ${audioResult.originalName}`);
      this.logger.info(`🖼️  封面: ${coverResult.originalName}`);
      
      return {
        audioPath: audioResult.path,
        coverPath: coverResult.path,
        audioFileName: audioResult.originalName,
        coverFileName: coverResult.originalName
      };
    }
  }

  async ensureFileExtension(filePath, extension) {
    // 檢查檔案是否已經有正確的副檔名
    if (path.extname(filePath).toLowerCase() === extension.toLowerCase()) {
      return filePath;
    }

    // 如果沒有正確的副檔名，創建一個新的檔案名
    const newPath = filePath + extension;
    
    try {
      // 複製檔案到新的檔案名
      if (fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, newPath);
        this.logger.info(`📝 重新命名檔案: ${path.basename(filePath)} → ${path.basename(newPath)}`);
        return newPath;
      }
    } catch (error) {
      this.logger.warn(`重新命名檔案失敗: ${error.message}`);
    }
    
    return filePath; // 如果重新命名失敗，返回原檔案路徑
  }

  async handleError(error) {
    // 錯誤處理邏輯
    // 可以在這裡實現:
    // - 發送錯誤通知到 Slack
    // - 發送錯誤 Email
    // - 記錄到錯誤追蹤系統
    // - 更新 Airtable 錯誤狀態
    
    try {
      // 範例：記錄錯誤到 Airtable
      await this.airtable.logError({
        error: error.message,
        timestamp: new Date().toISOString(),
        stack: error.stack
      });
    } catch (logError) {
      this.logger.error('記錄錯誤失敗:', logError.message);
    }
  }

  startScheduledUpload() {
    const schedule = process.env.UPLOAD_SCHEDULE || '0 9 * * *'; // 預設每天早上 9 點
    
    this.logger.info(`⏰ 設定定時上傳，時間: ${schedule}`);
    
    cron.schedule(schedule, async () => {
      this.logger.info('🕐 執行定時 Podcast 上傳...');
      try {
        await this.processNextEpisode();
      } catch (error) {
        this.logger.error('定時上傳失敗:', error);
      }
    });
    
    this.logger.info('✅ 定時器已啟動');
  }

  async testUpload() {
    this.logger.info('🧪 執行測試上傳...');
    try {
      const result = await this.processNextEpisode();
      this.logger.info('✅ 測試上傳完成', result);
      return result;
    } catch (error) {
      this.logger.error('❌ 測試上傳失敗:', error);
      throw error;
    }
  }

  async cleanup() {
    // 清理臨時檔案
    try {
      const tempFiles = fs.readdirSync(this.tempDir);
      const oldFiles = tempFiles.filter(file => {
        const filePath = path.join(this.tempDir, file);
        const stats = fs.statSync(filePath);
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        return stats.mtime < dayAgo;
      });

      if (oldFiles.length > 0) {
        this.logger.info(`🗑️  清理 ${oldFiles.length} 個舊檔案...`);
        oldFiles.forEach(file => {
          const filePath = path.join(this.tempDir, file);
          fs.unlinkSync(filePath);
        });
      }
    } catch (error) {
      this.logger.warn('清理檔案失敗:', error.message);
    }
  }
}

// 主要執行邏輯
async function main() {
  const automation = new PodcastAutomation();
  
  try {
    // 檢查運行模式
    const mode = process.env.RUN_MODE || process.argv[2] || 'once';
    
    switch (mode) {
      case 'scheduled':
        // 定時運行模式
        automation.startScheduledUpload();
        // 保持程序運行
        process.stdin.resume();
        break;
        
      case 'test':
        // 測試模式
        await automation.testUpload();
        process.exit(0);
        break;
        
      case 'cleanup':
        // 清理模式
        await automation.cleanup();
        process.exit(0);
        break;
        
      case 'once':
      default:
        // 單次執行模式（預設）
        await automation.processNextEpisode();
        process.exit(0);
        break;
    }
    
  } catch (error) {
    console.error('💥 執行失敗:', error);
    process.exit(1);
  }
}

// 處理程序終止信號
process.on('SIGINT', async () => {
  console.log('\n🛑 收到終止信號，正在清理...');
  try {
    // 給一些時間清理資源
    await new Promise(resolve => setTimeout(resolve, 2000));
  } catch (error) {
    console.error('清理失敗:', error);
  }
  process.exit(0);
});

// 如果直接運行此檔案，執行主函數
if (require.main === module) {
  main();
}

module.exports = { PodcastAutomation };