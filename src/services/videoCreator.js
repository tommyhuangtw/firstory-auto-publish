require('dotenv').config();
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

class VideoCreator {
  /**
   * 將音檔 + 圖片合成為 MP4 影片（YouTube 可接受格式）
   * @param {string} audioPath - 音檔路徑 (.mp3)
   * @param {string} imagePath - 圖片路徑 (.jpg/.png)
   * @param {string} [outputPath] - 輸出路徑，預設為 temp 目錄
   * @returns {string} 輸出影片路徑
   */
  async createVideoFromAudioAndImage(audioPath, imagePath, outputPath = null) {
    console.log('🎬 開始合成 YouTube 影片...');
    console.log(`   音檔: ${path.basename(audioPath)}`);
    console.log(`   圖片: ${path.basename(imagePath)}`);

    // 確認檔案存在
    if (!await fs.pathExists(audioPath)) {
      throw new Error(`音檔不存在: ${audioPath}`);
    }
    if (!await fs.pathExists(imagePath)) {
      throw new Error(`圖片不存在: ${imagePath}`);
    }

    // 設定輸出路徑
    if (!outputPath) {
      const tempDir = path.join(__dirname, '../../temp');
      await fs.ensureDir(tempDir);
      const baseName = path.basename(audioPath, path.extname(audioPath));
      outputPath = path.join(tempDir, `${baseName}_youtube.mp4`);
    }

    // ffmpeg 合成指令
    // -loop 1: 循環圖片
    // -c:v libx264: H.264 視訊編碼
    // -tune stillimage: 針對靜態圖片最佳化（大幅縮小檔案）
    // -c:a aac: AAC 音訊編碼
    // -b:a 192k: 音訊位元率
    // -pix_fmt yuv420p: 確保最大相容性
    // -shortest: 音檔結束即停止
    // -vf scale: 縮放至 1920x1080 並加入黑邊保持比例
    const command = [
      'ffmpeg', '-y', '-nostdin',
      '-loop', '1',
      '-framerate', '1',
      '-i', `"${imagePath}"`,
      '-i', `"${audioPath}"`,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-g', '99999',
      '-threads', '0',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-pix_fmt', 'yuv420p',
      '-shortest',
      '-r', '1',
      '-vf', '"scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black"',
      `"${outputPath}"`
    ].join(' ');

    console.log('⏳ 正在合成影片（可能需要數分鐘）...');

    try {
      execSync(command, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 600000 // 10 分鐘超時
      });

      const stats = await fs.stat(outputPath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
      console.log(`✅ 影片合成完成: ${outputPath} (${sizeMB} MB)`);

      return outputPath;
    } catch (error) {
      console.error('❌ ffmpeg 影片合成失敗:', error.message);
      throw new Error(`影片合成失敗: ${error.message}`);
    }
  }
}

module.exports = { VideoCreator };
