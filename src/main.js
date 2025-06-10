const cron = require('node-cron');
const { PodcastUploader } = require('./uploader');
const { AirtableService } = require('./services/airtable');
const { GoogleDriveService } = require('./services/googleDrive');
const { LLMService } = require('./services/llm');
const { Logger } = require('./utils/logger');

require('dotenv').config();

class PodcastAutomation {
  constructor() {
    this.uploader = new PodcastUploader();
    this.airtable = new AirtableService();
    this.googleDrive = new GoogleDriveService();
    this.llm = new LLMService();
    this.logger = new Logger();
  }

  async processNextEpisode() {
    try {
      this.logger.info('開始處理下一集 Podcast...');
      
      // 初始化 Google Drive 認證
      await this.googleDrive.initializeAuth();
      
      // 1. 從 Airtable 獲取待上傳的 Podcast 資料
      const episodeData = await this.airtable.getNextEpisodeToUpload();
      if (!episodeData) {
        this.logger.info('沒有待上傳的 Podcast 集數');
        return;
      }

      this.logger.info(`準備上傳集數: ${episodeData.title}`);

      // 2. 使用 LLM 生成標題和描述
      const content = await this.llm.generateEpisodeContent(episodeData);
      
      // 3. 從 Google Drive 下載最新的音檔和封面
      this.logger.info('從 Google Drive 下載檔案...');
      const audioResult = await this.googleDrive.downloadLatestAudioFile();
      const coverResult = await this.googleDrive.downloadLatestCoverImage();
      
      this.logger.info(`音檔: ${audioResult.originalName}`);
      this.logger.info(`封面: ${coverResult.originalName}`);

      // 4. 上傳到 SoundOn
      const uploadResult = await this.uploader.uploadEpisode({
        title: content.title,
        description: content.description,
        audioPath: audioResult.path,
        coverPath: coverResult.path,
        episodeData
      });

      if (uploadResult.success) {
        // 5. 更新 Airtable 狀態
        await this.airtable.markEpisodeAsUploaded(episodeData.id);
        this.logger.info('Podcast 上傳成功！');
      } else {
        throw new Error(uploadResult.error);
      }

    } catch (error) {
      this.logger.error('處理 Podcast 時發生錯誤:', error);
      // 可以在這裡添加錯誤通知邏輯
    }
  }

  startScheduledUpload() {
    const schedule = process.env.UPLOAD_SCHEDULE || '0 9 * * *';
    
    this.logger.info(`設定定時上傳，時間: ${schedule}`);
    
    cron.schedule(schedule, async () => {
      this.logger.info('執行定時 Podcast 上傳...');
      await this.processNextEpisode();
    });
    
    this.logger.info('定時器已啟動');
  }

  async testUpload() {
    this.logger.info('執行測試上傳...');
    await this.processNextEpisode();
  }
}

// 啟動應用程式
const automation = new PodcastAutomation();

// 直接執行上傳流程
automation.processNextEpisode().then(() => {
  console.log('執行完成');
  process.exit(0);
}).catch((error) => {
  console.error('執行失敗:', error);
  process.exit(1);
});

module.exports = { PodcastAutomation };