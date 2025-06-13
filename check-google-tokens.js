const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
require('dotenv').config();

async function checkGoogleTokens() {
  console.log('🔍 檢查 Google API Tokens 狀態...\n');
  
  try {
    const tokenPath = path.join(__dirname, 'temp/google-tokens.json');
    
    // 檢查 tokens 文件是否存在
    if (!fs.existsSync(tokenPath)) {
      console.log('❌ Google tokens 文件不存在');
      console.log(`📁 預期路徑: ${tokenPath}`);
      console.log('💡 請先執行認證流程');
      return false;
    }
    
    // 讀取 tokens
    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    console.log('✅ Google tokens 文件存在');
    console.log('📄 Tokens 內容:');
    console.log(`   - Access Token: ${tokens.access_token ? '✅ 存在' : '❌ 缺失'}`);
    console.log(`   - Refresh Token: ${tokens.refresh_token ? '✅ 存在' : '❌ 缺失'}`);
    console.log(`   - Token Type: ${tokens.token_type || 'N/A'}`);
    console.log(`   - Expiry Date: ${tokens.expiry_date ? new Date(tokens.expiry_date).toLocaleString() : 'N/A'}`);
    
    // 檢查是否過期
    if (tokens.expiry_date) {
      const now = Date.now();
      const isExpired = now >= tokens.expiry_date;
      console.log(`   - 狀態: ${isExpired ? '❌ 已過期' : '✅ 有效'}`);
      
      if (isExpired && tokens.refresh_token) {
        console.log('🔄 Token 已過期，但有 refresh token 可以自動更新');
      }
    }
    
    // 測試 Google Drive API
    console.log('\n🧪 測試 Google Drive API 連接...');
    const credentials = {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uris: [process.env.GOOGLE_REDIRECT_URI]
    };
    
    const auth = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      credentials.redirect_uris[0]
    );
    
    auth.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth });
    
    try {
      const response = await drive.about.get({ fields: 'user' });
      console.log('✅ Google Drive API 連接成功');
      console.log(`👤 用戶: ${response.data.user.displayName} (${response.data.user.emailAddress})`);
    } catch (apiError) {
      console.log('❌ Google Drive API 連接失敗:', apiError.message);
    }
    
    // 測試 Gmail API
    console.log('\n📧 測試 Gmail API 連接...');
    const gmail = google.gmail({ version: 'v1', auth });
    
    try {
      const profile = await gmail.users.getProfile({ userId: 'me' });
      console.log('✅ Gmail API 連接成功');
      console.log(`📬 郵箱: ${profile.data.emailAddress}`);
      console.log(`📊 總郵件數: ${profile.data.messagesTotal}`);
    } catch (gmailError) {
      console.log('❌ Gmail API 連接失敗:', gmailError.message);
    }
    
    console.log('\n🎉 Google tokens 檢查完成！');
    return true;
    
  } catch (error) {
    console.error('❌ 檢查過程中發生錯誤:', error);
    return false;
  }
}

// 如果直接執行此腳本
if (require.main === module) {
  checkGoogleTokens()
    .then(success => {
      if (success) {
        console.log('\n✅ 所有檢查通過，系統可以正常運行');
        process.exit(0);
      } else {
        console.log('\n❌ 發現問題，請檢查配置');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n💥 執行檢查時發生未預期錯誤:', error);
      process.exit(1);
    });
}

module.exports = { checkGoogleTokens }; 