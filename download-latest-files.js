#!/usr/bin/env node
/**
 * 從 Google Drive 文件夾下載最新檔案
 * 
 * 使用方式:
 * node download-latest-files.js
 */

const { GoogleDriveService } = require('./src/services/googleDrive');

// 你的 Google Drive 文件夾連結
const AUDIO_FOLDER_URL = 'https://drive.google.com/drive/folders/1pB2PaU9BAKi0IGbIgudUEm29bgPhX1jq?usp=sharing';
const IMAGE_FOLDER_URL = 'https://drive.google.com/drive/folders/1BCSiZXS8aGnMdOnfJfAbwgitFfliVbQ-?usp=drive_link';

async function downloadLatestFiles() {
  console.log('🚀 開始從 Google Drive 文件夾下載最新檔案...');
  console.log('================================================\n');
  
  const googleDrive = new GoogleDriveService();
  
  try {
    console.log('📁 音檔文件夾:', AUDIO_FOLDER_URL);
    console.log('📁 圖片文件夾:', IMAGE_FOLDER_URL);
    console.log('');
    
    // 從文件夾下載最新檔案
    const result = await googleDrive.downloadLatestFilesFromFolders(
      AUDIO_FOLDER_URL,
      IMAGE_FOLDER_URL
    );
    
    console.log('\n📋 下載結果:');
    console.log('============');
    
    if (result.audio) {
      console.log(`🎵 音檔: ${result.audio.fileName}`);
      console.log(`   路徑: ${result.audio.path}`);
      console.log(`   類型: ${result.audio.type}`);
      if (result.audio.needsRealDownload) {
        console.log('   ⚠️  需要實際下載');
      }
    }
    
    if (result.image) {
      console.log(`🖼️ 圖片: ${result.image.fileName}`);
      console.log(`   路徑: ${result.image.path}`);
      console.log(`   類型: ${result.image.type}`);
      if (result.image.needsRealDownload) {
        console.log('   ⚠️  需要實際下載');
      }
    }
    
    console.log(`\n⏰ 下載時間: ${result.timestamp}`);
    
    // 顯示 JSON 檔案內容
    const pathsData = await googleDrive.loadPathsFromJson();
    if (pathsData) {
      console.log('\n💾 已儲存的路徑資訊:');
      console.log(JSON.stringify(pathsData, null, 2));
    }
    
    console.log('\n✅ 檔案下載和路徑儲存完成！');
    console.log('\n🚀 下一步可以執行:');
    console.log('   npm run test     # 測試 Firstory 上傳');
    console.log('   npm start        # 正式上傳到 Firstory');
    
  } catch (error) {
    console.error('\n💥 下載失敗:', error.message);
    
    if (error.message.includes('無法直接從文件夾下載')) {
      console.log('\n💡 解決方案:');
      console.log('   由於 Google Drive 的限制，我們需要個別檔案的分享連結');
      console.log('   請執行: npm run setup-guide');
      console.log('   按照指導取得個別檔案連結');
    }
    
    process.exit(1);
  }
}

// 處理未捕獲的錯誤
process.on('unhandledRejection', (reason, promise) => {
  console.error('未處理的 Promise 拒絕:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('未捕獲的例外:', error);
  process.exit(1);
});

// 執行下載
if (require.main === module) {
  downloadLatestFiles();
}

module.exports = { downloadLatestFiles }; 