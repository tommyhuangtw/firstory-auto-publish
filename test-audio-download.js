const { GoogleDriveService } = require('./src/services/googleDrive');
require('dotenv').config();

(async () => {
  const gdrive = new GoogleDriveService();
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  try {
    console.log('🎵 測試下載最新音檔...');
    const audioResult = await gdrive.downloadLatestAudioFile();
    console.log('✅ 成功！音檔資訊:');
    console.log(`   檔案名稱: ${audioResult.originalName}`);
    console.log(`   本地路徑: ${audioResult.path}`);
    console.log(`   檔案 ID: ${audioResult.fileId}`);
  } catch (error) {
    console.error('❌ 失敗:', error.message);
  }
})();