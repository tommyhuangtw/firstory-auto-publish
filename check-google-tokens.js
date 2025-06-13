require('dotenv').config();
const { GoogleDriveService } = require('./src/services/googleDrive');
const fs = require('fs-extra');
const path = require('path');

async function checkTokens() {
  console.log('🔍 檢查 Google Drive Tokens 狀態...\n');
  
  const googleDrive = new GoogleDriveService();
  const tokenPath = path.join(__dirname, 'temp/google-tokens.json');
  
  // 檢查 token 文件是否存在
  if (fs.existsSync(tokenPath)) {
    console.log('✅ Token 文件存在:', tokenPath);
    
    try {
      const tokens = await fs.readJSON(tokenPath);
      console.log('\n📋 Token 詳情:');
      console.log('- Access Token:', tokens.access_token ? '✅ 已設定' : '❌ 未設定');
      console.log('- Refresh Token:', tokens.refresh_token ? '✅ 已設定' : '❌ 未設定');
      console.log('- Expiry Date:', tokens.expiry_date ? new Date(tokens.expiry_date).toLocaleString() : '未設定');
      console.log('- Scope:', tokens.scope || '未設定');
      
      // 檢查是否過期
      if (tokens.expiry_date) {
        const now = Date.now();
        const expired = now > tokens.expiry_date;
        console.log('- Token 狀態:', expired ? '❌ 已過期' : '✅ 有效');
      }
      
    } catch (error) {
      console.log('❌ 讀取 token 文件失敗:', error.message);
    }
  } else {
    console.log('❌ Token 文件不存在:', tokenPath);
  }
  
  // 嘗試驗證 tokens
  console.log('\n🔐 測試 Google Drive 連接...');
  try {
    await googleDrive.initializeAuth();
    console.log('✅ Google Drive 連接成功！');
  } catch (error) {
    console.log('❌ Google Drive 連接失敗:', error.message);
  }
}

checkTokens().catch(console.error); 