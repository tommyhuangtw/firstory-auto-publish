#!/usr/bin/env node
/**
 * 測試簡化版 Google Drive 服務
 */

require('dotenv').config();
const { GoogleDriveService } = require('./src/services/googleDrive');

async function testSimplifiedGoogleDrive() {
  console.log('🚀 測試簡化版 Google Drive 服務...\n');

  const googleDrive = new GoogleDriveService();
  
  try {
    // 檢查環境變數
    const audioUrl = process.env.GOOGLE_DRIVE_AUDIO_URL;
    const coverUrl = process.env.GOOGLE_DRIVE_COVER_URL;
    
    console.log('📊 設定檢查:');
    console.log(`   音檔連結: ${audioUrl ? '✅ 已設定' : '❌ 未設定'}`);
    console.log(`   封面連結: ${coverUrl ? '✅ 已設定' : '❌ 未設定'}`);
    console.log('');
    
    if (!audioUrl && !coverUrl) {
      console.log('⚠️  請在 .env 檔案中設定 Google Drive 連結:');
      console.log('   GOOGLE_DRIVE_AUDIO_URL=https://drive.google.com/file/d/YOUR_AUDIO_ID/view');
      console.log('   GOOGLE_DRIVE_COVER_URL=https://drive.google.com/file/d/YOUR_COVER_ID/view');
      return;
    }
    
    // 測試 URL 解析
    if (audioUrl) {
      console.log('🎵 測試音檔 URL 解析...');
      try {
        const fileId = googleDrive.extractFileIdFromUrl(audioUrl);
        console.log(`   檔案 ID: ${fileId}`);
        console.log(`   下載連結: ${googleDrive.generateDirectDownloadUrl(fileId)}`);
      } catch (error) {
        console.log(`   ❌ URL 解析失敗: ${error.message}`);
      }
    }
    
    if (coverUrl) {
      console.log('🖼️ 測試封面 URL 解析...');
      try {
        const fileId = googleDrive.extractFileIdFromUrl(coverUrl);
        console.log(`   檔案 ID: ${fileId}`);
        console.log(`   下載連結: ${googleDrive.generateDirectDownloadUrl(fileId)}`);
      } catch (error) {
        console.log(`   ❌ URL 解析失敗: ${error.message}`);
      }
    }
    
    console.log('');
    
    // 測試實際下載 (如果 URL 存在)
    if (audioUrl) {
      console.log('🎵 測試音檔下載...');
      try {
        const audioResult = await googleDrive.downloadLatestAudioFile();
        console.log('✅ 音檔下載成功!');
        console.log(`   檔案名稱: ${audioResult.originalName}`);
        console.log(`   本地路徑: ${audioResult.path}`);
        console.log(`   檔案 ID: ${audioResult.fileId}\n`);
      } catch (error) {
        console.log(`❌ 音檔下載失敗: ${error.message}\n`);
      }
    }
    
    if (coverUrl) {
      console.log('🖼️ 測試封面下載...');
      try {
        const coverResult = await googleDrive.downloadLatestCoverImage();
        console.log('✅ 封面下載成功!');
        console.log(`   檔案名稱: ${coverResult.originalName}`);
        console.log(`   本地路徑: ${coverResult.path}`);
        console.log(`   檔案 ID: ${coverResult.fileId}\n`);
      } catch (error) {
        console.log(`❌ 封面下載失敗: ${error.message}\n`);
      }
    }
    
    console.log('🎉 簡化版 Google Drive 測試完成!');
    console.log('');
    console.log('💡 使用建議:');
    console.log('   - 確保 Google Drive 連結設定為「知道連結的任何人」可檢視');
    console.log('   - 檔案會自動下載到 temp/ 目錄');
    console.log('   - 支援任何公開的 Google Drive 檔案');
    
  } catch (error) {
    console.error('💥 測試失敗:', error);
  }
}

// 執行測試
testSimplifiedGoogleDrive(); 