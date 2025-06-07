#!/usr/bin/env node
/**
 * 測試 Google Drive API 連線和功能
 * 
 * 使用方式: npm run test-google-api
 */

const { GoogleDriveAPIService } = require('./src/services/googleDriveAPI');
require('dotenv').config();

// 你的文件夾 URL
const AUDIO_FOLDER_URL = 'https://drive.google.com/drive/folders/1pB2PaU9BAKi0IGbIgudUEm29bgPhX1jq?usp=sharing';
const IMAGE_FOLDER_URL = 'https://drive.google.com/drive/folders/1BCSiZXS8aGnMdOnfJfAbwgitFfliVbQ-?usp=drive_link';

async function testGoogleDriveAPI() {
  console.log('🧪 測試 Google Drive API 連線...');
  console.log('=====================================\n');
  
  try {
    // 檢查環境變數
    console.log('🔍 檢查環境變數...');
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      throw new Error('❌ 找不到 GOOGLE_CLIENT_ID 或 GOOGLE_CLIENT_SECRET 環境變數');
    }
    
    console.log(`✅ Client ID: ${clientId.substring(0, 20)}...`);
    console.log(`✅ Client Secret: ${clientSecret.substring(0, 10)}...`);
    console.log('');
    
    // 初始化 Google Drive API 服務
    console.log('🚀 初始化 Google Drive API 服務...');
    const service = new GoogleDriveAPIService();
    
    // 測試初始化客戶端
    console.log('🔑 初始化 API 客戶端...');
    await service.initializeClient(clientId, clientSecret);
    console.log('');
    
    // 測試獲取音檔文件夾內容
    console.log('🎵 測試音檔文件夾...');
    console.log(`📁 文件夾 URL: ${AUDIO_FOLDER_URL}`);
    
    const audioFolderId = service.extractFileIdFromUrl(AUDIO_FOLDER_URL);
    console.log(`📋 文件夾 ID: ${audioFolderId}`);
    
    const audioFiles = await service.listFilesInFolder(audioFolderId, 'audio');
    
    if (audioFiles.length > 0) {
      console.log(`✅ 找到 ${audioFiles.length} 個音檔:`);
      audioFiles.slice(0, 3).forEach((file, index) => {
        const size = file.size ? `${Math.round(file.size / 1024 / 1024 * 10) / 10} MB` : 'Unknown';
        const modifiedTime = new Date(file.modifiedTime).toLocaleString();
        console.log(`   ${index + 1}. ${file.name} (${size}, 修改: ${modifiedTime})`);
      });
      if (audioFiles.length > 3) {
        console.log(`   ... 還有 ${audioFiles.length - 3} 個檔案`);
      }
    } else {
      console.log('⚠️  音檔文件夾中沒有找到音檔');
    }
    console.log('');
    
    // 測試獲取圖片文件夾內容
    console.log('🖼️ 測試圖片文件夾...');
    console.log(`📁 文件夾 URL: ${IMAGE_FOLDER_URL}`);
    
    const imageFolderId = service.extractFileIdFromUrl(IMAGE_FOLDER_URL);
    console.log(`📋 文件夾 ID: ${imageFolderId}`);
    
    const imageFiles = await service.listFilesInFolder(imageFolderId, 'image');
    
    if (imageFiles.length > 0) {
      console.log(`✅ 找到 ${imageFiles.length} 個圖片:`);
      imageFiles.slice(0, 3).forEach((file, index) => {
        const size = file.size ? `${Math.round(file.size / 1024 / 1024 * 10) / 10} MB` : 'Unknown';
        const modifiedTime = new Date(file.modifiedTime).toLocaleString();
        console.log(`   ${index + 1}. ${file.name} (${size}, 修改: ${modifiedTime})`);
      });
      if (imageFiles.length > 3) {
        console.log(`   ... 還有 ${imageFiles.length - 3} 個檔案`);
      }
    } else {
      console.log('⚠️  圖片文件夾中沒有找到圖片');
    }
    console.log('');
    
    // 測試下載功能（下載最新檔案的前 1KB 作為測試）
    if (audioFiles.length > 0 && imageFiles.length > 0) {
      console.log('📥 測試下載功能...');
      
      try {
        // 下載最新的音檔和圖片
        const result = await service.downloadLatestFiles(
          AUDIO_FOLDER_URL,
          IMAGE_FOLDER_URL,
          clientId,
          clientSecret
        );
        
        console.log('✅ 下載測試成功！');
        console.log(`🎵 音檔: ${result.audio?.fileName}`);
        console.log(`🖼️  圖片: ${result.image?.fileName}`);
        
      } catch (downloadError) {
        if (downloadError.message.includes('需要完成 OAuth 認證流程')) {
          console.log('⚠️  需要完成 OAuth 認證，這是正常的首次設定流程');
        } else {
          console.log(`⚠️  下載測試失敗: ${downloadError.message}`);
        }
      }
    }
    
    console.log('\n🎉 Google Drive API 基本功能測試完成！');
    
    if (audioFiles.length > 0 && imageFiles.length > 0) {
      console.log('\n🚀 下一步：');
      console.log('   1. 如果需要 OAuth 認證，請執行: npm run download-api');
      console.log('   2. 完成認證後，執行: npm run test');
      console.log('   3. 測試成功後，執行: npm start');
    } else {
      console.log('\n⚠️  注意：');
      console.log('   請確保文件夾中有音檔和圖片檔案');
      console.log('   並確保文件夾權限設定正確');
    }
    
  } catch (error) {
    console.error('\n💥 測試失敗:', error.message);
    
    if (error.message.includes('需要完成 OAuth 認證流程')) {
      console.log('\n💡 解決方案：');
      console.log('   這是首次使用的正常流程，請執行：');
      console.log('   npm run download-api');
      console.log('   按照提示完成 OAuth 認證');
    } else if (error.message.includes('找不到 Google 認證資訊')) {
      console.log('\n💡 解決方案：');
      console.log('   請確保 .env 檔案中有正確的：');
      console.log('   GOOGLE_CLIENT_ID=your_client_id');
      console.log('   GOOGLE_CLIENT_SECRET=your_client_secret');
    } else if (error.message.includes('獲取文件夾內容失敗')) {
      console.log('\n💡 解決方案：');
      console.log('   1. 確保文件夾 URL 正確');
      console.log('   2. 確保文件夾設為公開或有適當權限');
      console.log('   3. 確認已啟用 Google Drive API');
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

if (require.main === module) {
  testGoogleDriveAPI();
}

module.exports = { testGoogleDriveAPI }; 