#!/usr/bin/env node
/**
 * 最簡單的 Google Drive OAuth 認證
 * 使用 Google 推薦的桌面應用認證方式
 */

const { google } = require('googleapis');
const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');

require('dotenv').config();

async function simpleDesktopOAuth() {
  console.log('🔐 Google Drive 桌面應用認證');
  console.log('===============================\n');
  
  try {
    // 檢查環境變數
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      throw new Error('找不到 GOOGLE_CLIENT_ID 或 GOOGLE_CLIENT_SECRET');
    }
    
    console.log(`✅ Client ID: ${clientId.substring(0, 20)}...`);
    console.log(`✅ Client Secret: ${clientSecret.substring(0, 10)}...`);
    console.log('');
    
    // 使用標準的桌面應用 redirect URI
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      'http://localhost'
    );
    
    // 生成認證 URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/drive.readonly'],
      prompt: 'consent'
    });
    
    console.log('🔗 請複製以下連結到瀏覽器:');
    console.log('');
    console.log('📋 STEP 1: 複製這個連結');
    console.log('==========================================');
    console.log(authUrl);
    console.log('==========================================');
    console.log('');
    console.log('📝 STEP 2: 在瀏覽器中:');
    console.log('   1. 貼上連結並前往');
    console.log('   2. 登入 Google 帳戶');
    console.log('   3. 點擊「允許」');
    console.log('   4. 瀏覽器會顯示「此網站無法提供安全連線」錯誤頁面');
    console.log('   5. 這是正常的！從網址列複製完整的 URL');
    console.log('');
    console.log('📝 STEP 3: 複製錯誤頁面的完整 URL');
    console.log('   URL 會類似: http://localhost/?code=4/0AX4XfW...');
    console.log('   我們需要 code= 後面的部分');
    console.log('');
    
    // 創建讀取介面
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    // 等待用戶輸入完整 URL 或授權碼
    const userInput = await new Promise((resolve) => {
      rl.question('🔑 請貼上完整 URL 或只貼授權碼: ', (input) => {
        rl.close();
        resolve(input.trim());
      });
    });
    
    if (!userInput) {
      throw new Error('輸入不能為空');
    }
    
    // 提取授權碼
    let authCode;
    if (userInput.includes('code=')) {
      // 如果包含完整 URL，提取 code 參數
      const urlParams = new URLSearchParams(userInput.split('?')[1]);
      authCode = urlParams.get('code');
    } else {
      // 如果只是授權碼
      authCode = userInput;
    }
    
    if (!authCode) {
      throw new Error('無法從輸入中找到授權碼');
    }
    
    console.log('');
    console.log('⏳ 處理授權碼...');
    console.log(`📋 授權碼: ${authCode.substring(0, 20)}...`);
    
    // 交換授權碼獲取 token
    const { tokens } = await oauth2Client.getToken(authCode);
    oauth2Client.setCredentials(tokens);
    
    // 保存 token
    const tokenFile = path.join(__dirname, 'google-token.json');
    await fs.writeJson(tokenFile, tokens, { spaces: 2 });
    
    console.log('✅ 認證成功！Token 已保存到:', tokenFile);
    
    // 測試 API 連線
    console.log('');
    console.log('🧪 測試 API 連線...');
    
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    // 測試獲取用戶資訊
    const about = await drive.about.get({ fields: 'user' });
    console.log(`👤 已連接到帳戶: ${about.data.user.displayName}`);
    
    // 測試文件夾存取
    const audioFolderId = '1pB2PaU9BAKi0IGbIgudUEm29bgPhX1jq';
    const imageFolderId = '1BCSiZXS8aGnMdOnfJfAbwgitFfliVbQ-';
    
    console.log('');
    console.log('📁 測試文件夾存取...');
    
    // 測試音檔文件夾
    try {
      const audioResponse = await drive.files.list({
        q: `'${audioFolderId}' in parents and trashed=false`,
        fields: 'files(id,name,modifiedTime,size)',
        orderBy: 'modifiedTime desc',
        pageSize: 5
      });
      
      console.log(`🎵 音檔文件夾: 找到 ${audioResponse.data.files.length} 個檔案`);
      if (audioResponse.data.files.length > 0) {
        const latestAudio = audioResponse.data.files[0];
        const size = latestAudio.size ? `${Math.round(latestAudio.size / 1024 / 1024 * 10) / 10} MB` : 'Unknown';
        console.log(`   最新檔案: ${latestAudio.name} (${size})`);
        console.log(`   修改時間: ${new Date(latestAudio.modifiedTime).toLocaleString()}`);
      }
    } catch (folderError) {
      console.log(`⚠️  音檔文件夾存取失敗: ${folderError.message}`);
    }
    
    // 測試圖片文件夾
    try {
      const imageResponse = await drive.files.list({
        q: `'${imageFolderId}' in parents and trashed=false`,
        fields: 'files(id,name,modifiedTime,size)',
        orderBy: 'modifiedTime desc',
        pageSize: 5
      });
      
      console.log(`🖼️  圖片文件夾: 找到 ${imageResponse.data.files.length} 個檔案`);
      if (imageResponse.data.files.length > 0) {
        const latestImage = imageResponse.data.files[0];
        const size = latestImage.size ? `${Math.round(latestImage.size / 1024 / 1024 * 10) / 10} MB` : 'Unknown';
        console.log(`   最新檔案: ${latestImage.name} (${size})`);
        console.log(`   修改時間: ${new Date(latestImage.modifiedTime).toLocaleString()}`);
      }
    } catch (folderError) {
      console.log(`⚠️  圖片文件夾存取失敗: ${folderError.message}`);
    }
    
    console.log('');
    console.log('🎉 OAuth 認證完成！');
    console.log('');
    console.log('🚀 下一步，測試完整的 Google Drive API:');
    console.log('   npm run test-google-api');
    console.log('');
    console.log('📁 或測試完整的 Firstory 上傳流程:');
    console.log('   npm run test');
    console.log('   npm start');
    
  } catch (error) {
    console.error('');
    console.error('💥 OAuth 認證失敗:', error.message);
    
    if (error.message.includes('invalid_grant')) {
      console.error('');
      console.error('💡 可能的解決方案:');
      console.error('   1. 授權碼已過期，請重新獲取');
      console.error('   2. 確保授權碼完整複製，沒有多餘空格');
      console.error('   3. 重新執行此腳本: npm run oauth-simple');
    } else if (error.message.includes('redirect_uri_mismatch')) {
      console.error('');
      console.error('💡 解決方案:');
      console.error('   請在 Google Cloud Console 中添加 redirect URI:');
      console.error('   - 前往 APIs & Services > Credentials');
      console.error('   - 編輯 OAuth 2.0 Client ID');
      console.error('   - 添加 Authorized redirect URI: http://localhost');
    }
    
    process.exit(1);
  }
}

if (require.main === module) {
  simpleDesktopOAuth();
}

module.exports = { simpleDesktopOAuth }; 