#!/usr/bin/env node
/**
 * 修復版 Google Drive OAuth 認證流程
 * 使用本地 HTTP 服務器接收回調
 */

const { google } = require('googleapis');
const fs = require('fs-extra');
const path = require('path');
const http = require('http');
const url = require('url');
const open = require('open');

require('dotenv').config();

async function fixedOAuth() {
  console.log('🔐 Google Drive OAuth 認證 (修復版)');
  console.log('====================================\n');
  
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
    
    // 使用本地 HTTP 服務器
    const redirectPort = 3000;
    const redirectUri = `http://localhost:${redirectPort}`;
    
    console.log('🚀 啟動本地認證服務器...');
    
    // 創建 OAuth2 客戶端
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );
    
    // 生成認證 URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/drive.readonly'],
      prompt: 'consent'
    });
    
    // 創建本地 HTTP 服務器來接收回調
    const server = http.createServer();
    
    const authCode = await new Promise((resolve, reject) => {
      server.on('request', (req, res) => {
        try {
          const parsedUrl = url.parse(req.url, true);
          
          if (parsedUrl.pathname === '/') {
            const code = parsedUrl.query.code;
            const error = parsedUrl.query.error;
            
            if (error) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
                <html>
                  <body>
                    <h1>❌ 認證失敗</h1>
                    <p>錯誤: ${error}</p>
                    <p>請關閉此視窗並重試</p>
                  </body>
                </html>
              `);
              reject(new Error(`OAuth 錯誤: ${error}`));
              return;
            }
            
            if (code) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
                <html>
                  <body>
                    <h1>✅ 認證成功！</h1>
                    <p>已獲取授權碼，正在處理...</p>
                    <p>您可以關閉此視窗了</p>
                    <script>
                      setTimeout(() => {
                        window.close();
                      }, 3000);
                    </script>
                  </body>
                </html>
              `);
              
              server.close();
              resolve(code);
            } else {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
                <html>
                  <body>
                    <h1>⚠️ 未收到授權碼</h1>
                    <p>請重試認證流程</p>
                  </body>
                </html>
              `);
            }
          }
        } catch (error) {
          reject(error);
        }
      });
      
      server.listen(redirectPort, () => {
        console.log(`🌐 本地服務器啟動於: ${redirectUri}`);
        console.log('');
        console.log('🔗 正在打開瀏覽器進行認證...');
        console.log('   如果瀏覽器沒有自動打開，請手動訪問:');
        console.log(`   ${authUrl}`);
        console.log('');
        
        // 自動打開瀏覽器
        open(authUrl).catch(() => {
          console.log('⚠️  無法自動打開瀏覽器，請手動複製上方連結到瀏覽器');
        });
      });
      
      server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`端口 ${redirectPort} 已被占用，請先停止其他服務或稍後重試`));
        } else {
          reject(error);
        }
      });
    });
    
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
        fields: 'files(id,name,modifiedTime,size)',
        orderBy: 'modifiedTime desc',
        pageSize: 5
      });
      
      console.log(`🎵 音檔文件夾: 找到 ${audioResponse.data.files.length} 個檔案`);
      if (audioResponse.data.files.length > 0) {
        const latestAudio = audioResponse.data.files[0];
        const size = latestAudio.size ? `${Math.round(latestAudio.size / 1024 / 1024 * 10) / 10} MB` : 'Unknown';
        console.log(`   最新檔案: ${latestAudio.name} (${size})`);
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
    } else if (error.message.includes('EADDRINUSE')) {
      console.error('');
      console.error('💡 解決方案:');
      console.error('   請先停止占用端口 3000 的服務，或者稍後重試');
    }
    
    process.exit(1);
  }
}

if (require.main === module) {
  fixedOAuth();
}

module.exports = { fixedOAuth }; 