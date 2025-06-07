#!/usr/bin/env node
/**
 * 測試 Google Drive 服務 - 從指定文件夾獲取最新文件
 */

require('dotenv').config();
const { GoogleDriveService } = require('./src/services/googleDrive');

async function testGoogleDrive() {
  console.log('🚀 測試 Google Drive 服務...\n');

  const googleDrive = new GoogleDriveService();
  
  try {
    // 等待 Google Drive 初始化
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('📁 文件夾配置:');
    console.log(`   封面圖片文件夾: ${googleDrive.COVER_FOLDER_ID}`);
    console.log(`   音檔文件夾: ${googleDrive.AUDIO_FOLDER_ID}\n`);
    
    // 測試獲取最新封面圖片
    console.log('🖼️ 測試獲取最新封面圖片...');
    try {
      const coverResult = await googleDrive.downloadLatestCoverImage();
      console.log('✅ 封面圖片下載成功!');
      console.log(`   📁 檔案名稱: ${coverResult.originalName}`);
      console.log(`   💾 本地路徑: ${coverResult.path}`);
      console.log(`   🆔 Google Drive ID: ${coverResult.fileId}\n`);
    } catch (error) {
      console.log('❌ 封面圖片下載失敗:', error.message, '\n');
    }
    
    // 測試獲取最新音檔
    console.log('🎵 測試獲取最新音檔...');
    try {
      const audioResult = await googleDrive.downloadLatestAudioFile();
      console.log('✅ 音檔下載成功!');
      console.log(`   📁 檔案名稱: ${audioResult.originalName}`);
      console.log(`   💾 本地路徑: ${audioResult.path}`);
      console.log(`   🆔 Google Drive ID: ${audioResult.fileId}\n`);
    } catch (error) {
      console.log('❌ 音檔下載失敗:', error.message, '\n');
    }
    
    console.log('🎉 Google Drive 測試完成!');
    console.log('\n📋 下載的檔案將用於 Firstory 上傳流程');
    
  } catch (error) {
    console.error('💥 Google Drive 測試失敗:', error);
  }
}

// 執行測試
testGoogleDrive();