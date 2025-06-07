#!/usr/bin/env node
/**
 * 測試 Google Drive 服務帳戶認證和基本權限
 */

require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs-extra');

async function testDriveAuth() {
  console.log('🔐 測試 Google Drive 服務帳戶認證...\n');

  try {
    // 讀取憑證
    const credentialsPath = './config/google-credentials.json';
    const credentials = await fs.readJSON(credentialsPath);
    
    console.log('📧 服務帳戶 Email:', credentials.client_email);
    console.log('🏷️ 專案 ID:', credentials.project_id);
    
    // 建立認證
    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });

    const drive = google.drive({ version: 'v3', auth });
    
    // 測試基本 API 調用 - 列出用戶的根目錄
    console.log('\n🔍 測試 API 調用...');
    
    const response = await drive.files.list({
      pageSize: 10,
      fields: 'files(id, name, mimeType)',
    });

    const files = response.data.files;
    console.log(`✅ API 調用成功，找到 ${files.length} 個檔案/文件夾`);
    
    if (files.length > 0) {
      console.log('\n📁 可存取的檔案/文件夾:');
      files.forEach((file, index) => {
        console.log(`   ${index + 1}. ${file.name} (${file.mimeType})`);
      });
    }
    
    // 測試特定文件夾權限
    console.log('\n🔍 測試特定文件夾存取權限...');
    
    const folderIds = [
      '1BCSiZXS8aGnMdOnfJfAbwgitFfliVbQ-', // 封面圖片文件夾
      '1pB2PaU9BAKi0IGbIgudUEm29bgPhX1jq'  // 音檔文件夾
    ];
    
    for (const folderId of folderIds) {
      try {
        const folderResponse = await drive.files.get({
          fileId: folderId,
          fields: 'id, name, mimeType'
        });
        
        console.log(`✅ 可存取文件夾: ${folderResponse.data.name} (${folderId})`);
      } catch (error) {
        console.log(`❌ 無法存取文件夾 ${folderId}: ${error.message}`);
      }
    }
    
    console.log('\n📋 下一步:');
    console.log('   如果看到 "❌ 無法存取文件夾"，請將以下 Email 加入文件夾的共享對象:');
    console.log(`   📧 ${credentials.client_email}`);
    console.log('   🔗 權限: 檢視者 (Viewer)');
    
  } catch (error) {
    console.error('💥 測試失敗:', error);
  }
}

// 執行測試
testDriveAuth();