#!/usr/bin/env node
/**
 * 簡化的 Google Drive OAuth 認證流程
 */

const { google } = require('googleapis');
const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');

require('dotenv').config();

async function simpleOAuth() {
  console.log('🔐 Google Drive OAuth 認證');
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
    
    // 創建 OAuth2 客戶端
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      'urn:ietf:wg:oauth:2.0:oob'
    );
    
    // 生成認證 URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/drive.readonly']
    });
    
    console.log('🔗 請打開瀏覽器並訪問以下連結:');
    console.log('');
    console.log(authUrl);
    console.log('');
    console.log('📋 完成授權後，複製授權碼並貼到下方:');
    console.log('');
    
    // 創建讀取介面
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    // 等待用戶輸入授權碼
    const authCode = await new Promise((resolve) => {
      rl.question('🔑 請輸入授權碼: ', (code) => {
        rl.close();
        resolve(code.trim());
      });
    });
    
    if (!authCode) {
      throw new Error('授權碼不能為空');
    }
    
    console.log('');
    console.log('⏳ 處理授權碼...');
    
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
        fields: 'files(id,name,modifiedTime)',
        orderBy: 'modifiedTime desc',
        pageSize: 5
      });
      
      console.log(`🎵 音檔文件夾: 找到 ${audioResponse.data.files.length} 個檔案`);
      if (audioResponse.data.files.length > 0) {
        console.log(`   最新檔案: ${audioResponse.data.files[0].name}`);
      }
    } catch (folderError) {
      console.log(`⚠️  音檔文件夾存取失敗: ${folderError.message}`);
    }
    
    // 測試圖片文件夾
    try {
      const imageResponse = await drive.files.list({
        q: `'${imageFolderId}' in parents and trashed=false`,
        fields: 'files(id,name,modifiedTime)',
        orderBy: 'modifiedTime desc',
        pageSize: 5
      });
      
      console.log(`🖼️  圖片文件夾: 找到 ${imageResponse.data.files.length} 個檔案`);
      if (imageResponse.data.files.length > 0) {
        console.log(`   最新檔案: ${imageResponse.data.files[0].name}`);
      }
    } catch (folderError) {
      console.log(`⚠️  圖片文件夾存取失敗: ${folderError.message}`);
    }
    
    console.log('');
    console.log('🎉 OAuth 認證完成！現在可以使用以下命令:');
    console.log('   npm run test-google-api    # 重新測試 API');
    console.log('   npm run test               # 測試完整流程');
    console.log('   npm start                  # 開始上傳');
    
  } catch (error) {
    console.error('');
    console.error('💥 OAuth 認證失敗:', error.message);
    
    if (error.message.includes('invalid_grant')) {
      console.error('');
      console.error('💡 可能的解決方案:');
      console.error('   1. 授權碼已過期，請重新獲取');
      console.error('   2. 確保授權碼完整複製，沒有多餘空格');
      console.error('   3. 重新執行此腳本');
    }
    
    process.exit(1);
  }
}

if (require.main === module) {
  simpleOAuth();
}

module.exports = { simpleOAuth }; 