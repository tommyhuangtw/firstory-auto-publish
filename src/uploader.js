const { SoundOnUploader } = require('./soundon-uploader');

class PodcastUploader {
  constructor() {
    this.soundOnUploader = new SoundOnUploader();
  }

  async uploadEpisode({ title, description, audioPath, coverPath, episodeData }) {
    try {
      // 初始化 SoundOnUploader
      await this.soundOnUploader.initialize();
      
      // 執行登入
      const loginSuccess = await this.soundOnUploader.login();
      if (!loginSuccess) {
        return { success: false, error: '登入失敗' };
      }

      // 使用完整的上傳邏輯
      const result = await this.soundOnUploader.uploadEpisode({
        title,
        description,
        audioPath,
        coverPath
      });

      return result;
      
    } catch (error) {
      console.error('上傳失敗:', error);
      return { success: false, error: error.message };
    } finally {
      // 清理資源
      if (this.soundOnUploader) {
        await this.soundOnUploader.close();
      }
    }
  }

  async fillDescription(description) {
    // 嘗試不同的選擇器來找到描述欄位
    const descriptionSelectors = [
      'textarea[placeholder*="描述"]',
      'textarea[name*="description"]',
      '.ql-editor', // Quill editor
      'div[contenteditable="true"]'
    ];

    for (const selector of descriptionSelectors) {
      try {
        const element = this.soundOnUploader.page.locator(selector);
        if (await element.isVisible()) {
          await element.fill(description);
          break;
        }
      } catch (e) {
        continue;
      }
    }
  }

  async uploadCoverImage(coverPath) {
    try {
      const imageInput = this.soundOnUploader.page.locator('input[type="file"][accept*="image"]');
      await imageInput.setInputFiles(coverPath);
      await this.soundOnUploader.page.waitForTimeout(3000); // 等待圖片上傳
    } catch (error) {
      console.error('封面上傳失敗:', error);
    }
  }
}

module.exports = { PodcastUploader };