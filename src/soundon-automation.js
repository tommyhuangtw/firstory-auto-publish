const { GoogleDriveService } = require('./services/googleDrive');
const { SoundOnUploader } = require('./soundon-uploader');
const { AirtableService } = require('./services/airtable');
const { Logger } = require('./utils/logger');
const path = require('path');
const fs = require('fs');

class SoundOnAutomation {
  constructor() {
    this.logger = new Logger();
    this.googleDrive = new GoogleDriveService();
    this.soundonUploader = new SoundOnUploader();
    this.airtable = new AirtableService();
    this.downloadDir = path.join(__dirname, '..', 'temp', 'downloads');
  }

  async initialize() {
    this.logger.info('初始化 SoundOn 自動化系統...');
    
    // 確保下載目錄存在
    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true });
    }
    
    // 初始化 Google Drive
    await this.googleDrive.initializeAuth();
    
    // 初始化 SoundOn Uploader
    await this.soundonUploader.initialize();
  }

  async downloadLatestAudio() {
    this.logger.info('正在從 Google Drive 下載最新音檔...');
    
    try {
      const audioInfo = await this.googleDrive.downloadLatestAudioFile();
      this.logger.info(`成功下載音檔: ${audioInfo.originalName} (${(fs.statSync(audioInfo.path).size / 1024 / 1024).toFixed(2)} MB)`);
      
      return audioInfo;
    } catch (error) {
      this.logger.error('下載音檔失敗:', error);
      throw error;
    }
  }

  async generateEpisodeInfo(audioFileName) {
    try {
      this.logger.info('嘗試從 Airtable 獲取 Podcast 內容...');
      
      // 嘗試從 Airtable 獲取最新的 Podcast 記錄
      const records = await this.airtable.getRecordsToUpload();
      
      if (records && records.length > 0) {
        const latestRecord = records[0];
        
        // 檢查是否有有效的標題和內容
        if (latestRecord.title && latestRecord.title.trim()) {
          this.logger.info(`從 Airtable 找到記錄: ${latestRecord.title}`);
          
          return {
            title: latestRecord.title,
            description: latestRecord.content || latestRecord.description || this.generateDefaultDescription(),
            recordId: latestRecord.id
          };
        } else {
          this.logger.warn('Airtable 記錄中沒有有效的標題');
        }
      } else {
        this.logger.warn('Airtable 中沒有找到記錄');
      }
      
    } catch (error) {
      this.logger.warn('從 Airtable 獲取內容失敗:', error.message);
    }
    
    // 如果無法從 Airtable 獲取，使用預設內容
    this.logger.info('使用預設內容生成');
    return this.generateDefaultEpisodeInfo(audioFileName);
  }

  generateDefaultDescription() {
    return `本集 AI懶人報為您帶來最新的科技動態和深度分析。

在這一集中，我們將探討：
- 最新 AI 技術發展
- 科技產業趨勢分析  
- 實用工具推薦
- 創新應用案例

歡迎訂閱我們的頻道，持續關注最新內容！

---
AI懶人報 Podcast
讓您用最短時間掌握 AI 世界的最新動向`;
  }

  generateDefaultEpisodeInfo(audioFileName) {
    // 從檔案名稱生成標題和描述
    const baseName = path.basename(audioFileName, path.extname(audioFileName));
    
    // 基本的標題生成邏輯
    let title = baseName.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    
    // 如果包含日期，格式化標題
    const dateMatch = title.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (dateMatch) {
      const [, year, month, day] = dateMatch;
      title = `AI懶人報 ${year}/${month}/${day}`;
    }
    
    // 基本的描述模板
    const description = `本集 AI懶人報為您帶來最新的科技動態和深度分析。

在這一集中，我們將探討：
- 最新 AI 技術發展
- 科技產業趨勢分析  
- 實用工具推薦
- 創新應用案例

歡迎訂閱我們的頻道，持續關注最新內容！

---
AI懶人報 Podcast
讓您用最短時間掌握 AI 世界的最新動向`;
    
    return {
      title: title || '新集數',
      description: description
    };
  }

  async uploadToSoundOn(audioInfo) {
    try {
      this.logger.info('開始 SoundOn 上傳流程...');
      
      // 1. 登入 SoundOn
      const loginSuccess = await this.soundonUploader.login();
      if (!loginSuccess) {
        throw new Error('SoundOn 登入失敗');
      }
      
      // 2. 生成單集資訊
      const episodeInfo = await this.generateEpisodeInfo(audioInfo.originalName);
      this.logger.info(`生成單集資訊 - 標題: ${episodeInfo.title}`);
      
      // 3. 執行完整上傳流程
      const uploadResult = await this.soundonUploader.uploadEpisode({
        audioPath: audioInfo.path,
        title: episodeInfo.title,
        description: episodeInfo.description
      });
      
      if (uploadResult.success) {
        this.logger.info('✅ SoundOn 上傳完成！');
        
        // 如果有 recordId，更新 Airtable 狀態
        if (episodeInfo.recordId) {
          try {
            await this.airtable.updateRecordStatus(episodeInfo.recordId, 'Uploaded to SoundOn');
            this.logger.info('Airtable 記錄狀態已更新');
          } catch (error) {
            this.logger.warn('更新 Airtable 狀態失敗:', error.message);
          }
        }
        
        // 填入單集資訊
        const success = await this.soundonUploader.fillEpisodeInfo(episodeInfo);
        
        if (!success) {
          throw new Error('填入單集資訊失敗');
        }
        
        // 上傳封面圖片（如果有的話）
        this.logger.info('檢查是否有封面圖片需要上傳...');
        const coverImagePath = await this.getCoverImagePath();
        if (coverImagePath) {
          this.logger.info(`找到封面圖片: ${coverImagePath}`);
          const coverUploadSuccess = await this.soundonUploader.uploadCoverImage(coverImagePath);
          if (coverUploadSuccess) {
            this.logger.info('✅ 封面圖片上傳成功');
          } else {
            this.logger.warn('⚠️ 封面圖片上傳失敗，但繼續執行');
          }
        } else {
          this.logger.info('無封面圖片可上傳');
        }
        
        // 保存為草稿
        const draftSuccess = await this.soundonUploader.saveDraft();
        
        return true;
      } else {
        throw new Error(`上傳失敗: ${uploadResult.error}`);
      }
      
    } catch (error) {
      this.logger.error('SoundOn 上傳過程發生錯誤:', error);
      throw error;
    }
  }

  async convertAudioToMp3(audioPath) {
    this.logger.info('開始將音檔轉換為 MP3 格式...');
    
    const originalExt = path.extname(audioPath);
    let mp3Path;
    if (originalExt) {
      mp3Path = audioPath.replace(originalExt, '.mp3');
    } else {
      mp3Path = audioPath + '.mp3';
    }

    const command = `ffmpeg -i "${audioPath}" -codec:a libmp3lame -qscale:a 2 "${mp3Path}"`;

    try {
      await new Promise((resolve, reject) => {
        const process = require('child_process').exec(command, (error, stdout, stderr) => {
          if (error) {
            this.logger.error(`FFmpeg 轉換失敗: ${error.message}`);
            this.logger.error(`FFmpeg stderr: ${stderr}`);
            return reject(error);
          }
          this.logger.info('FFmpeg 轉換成功！');
          this.logger.info(`FFmpeg stdout: ${stdout}`);
          resolve();
        });
      });
      
      this.logger.info(`成功轉換音檔為 MP3: ${mp3Path}`);
      return mp3Path;
    } catch (error) {
      this.logger.error('音檔轉換為 MP3 失敗:', error);
      throw error;
    }
  }

  async run() {
    const downloadedFilePaths = [];
    try {
      // 初始化系統
      await this.initialize();
      
      // 下載最新音檔
      const audioInfo = await this.downloadLatestAudio();
      downloadedFilePaths.push(audioInfo.path);
      
      // 轉換音檔為 MP3
      const mp3AudioPath = await this.convertAudioToMp3(audioInfo.path);
      if (mp3AudioPath !== audioInfo.path) {
        downloadedFilePaths.push(mp3AudioPath);
      }
      
      // 更新 audioInfo 中的路徑
      const mp3AudioInfo = { ...audioInfo, path: mp3AudioPath };
      
      // 上傳到 SoundOn
      await this.uploadToSoundOn(mp3AudioInfo);
      
      this.logger.info('🎉 自動化流程完成！');
      
    } catch (error) {
      this.logger.error('自動化流程失敗:', error);
      throw error;
    } finally {
      // 清理資源
      try {
        downloadedFilePaths.forEach(filePath => {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            this.logger.info(`🗑️ 已清理音檔: ${filePath}`);
          }
        });
      } catch (cleanupError) {
        this.logger.error('清理音檔時發生錯誤:', cleanupError.message);
      }

      if (this.soundonUploader) {
        await this.soundonUploader.close();
      }
    }
  }

  async close() {
    if (this.soundonUploader) {
      await this.soundonUploader.close();
    }
  }

  async getCoverImagePath() {
    try {
      // 檢查是否有今天的 IG 縮圖
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      
      // 可能的圖片位置
      const possiblePaths = [
        path.join(process.cwd(), 'temp', `ig_thumbnail_${today}.jpg`),
        path.join(process.cwd(), 'temp', `ig_thumbnail_${today}.png`),
        path.join(process.cwd(), 'temp', `cover_${today}.jpg`),
        path.join(process.cwd(), 'temp', `cover_${today}.png`),
        path.join(process.cwd(), 'temp', 'latest_cover.jpg'),
        path.join(process.cwd(), 'temp', 'latest_cover.png'),
        // 也檢查是否有預設的封面圖片
        path.join(process.cwd(), 'assets', 'default_cover.jpg'),
        path.join(process.cwd(), 'assets', 'default_cover.png')
      ];
      
      // 檢查每個可能的路徑
      for (const imgPath of possiblePaths) {
        if (fs.existsSync(imgPath)) {
          this.logger.info(`找到封面圖片: ${imgPath}`);
          return imgPath;
        }
      }
      
      // 如果找不到特定日期的圖片，嘗試找最新的圖片
      const tempDir = path.join(process.cwd(), 'temp');
      if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        const imageFiles = files.filter(file => 
          (file.endsWith('.jpg') || file.endsWith('.png') || file.endsWith('.jpeg')) &&
          (file.includes('ig_') || file.includes('cover') || file.includes('thumbnail'))
        );
        
        if (imageFiles.length > 0) {
          // 按修改時間排序，取最新的
          const imageWithStats = imageFiles.map(file => {
            const filePath = path.join(tempDir, file);
            const stats = fs.statSync(filePath);
            return { file, path: filePath, mtime: stats.mtime };
          });
          
          imageWithStats.sort((a, b) => b.mtime - a.mtime);
          const latestImage = imageWithStats[0];
          
          this.logger.info(`使用最新的圖片: ${latestImage.path}`);
          return latestImage.path;
        }
      }
      
      this.logger.info('未找到封面圖片');
      return null;
      
    } catch (error) {
      this.logger.error('獲取封面圖片路徑失敗:', error);
      return null;
    }
  }
}

// 如果直接執行此檔案
if (require.main === module) {
  const automation = new SoundOnAutomation();
  automation.run().catch(error => {
    console.error('執行失敗:', error);
    process.exit(1);
  });
}

module.exports = { SoundOnAutomation }; 