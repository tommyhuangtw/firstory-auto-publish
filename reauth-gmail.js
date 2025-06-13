const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
require('dotenv').config();

async function reauthGmail() {
  console.log('🔄 重新認證 Gmail API...\n');
  
  try {
    const credentials = {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: 'http://localhost:3000/oauth2callback'
    };

    const auth = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      credentials.redirect_uri
    );

    // 創建本地服務器來接收回調
    const server = http.createServer();
    const PORT = 3000;

    // 生成認證 URL
    const authUrl = auth.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly'
      ],
      prompt: 'consent'
    });

    console.log('🌐 請在瀏覽器中打開以下 URL 進行認證:');
    console.log(authUrl);
    console.log('\n⏳ 等待授權回調...\n');

    // 啟動本地服務器
    const tokens = await new Promise((resolve, reject) => {
      server.on('request', async (req, res) => {
        try {
          const reqUrl = url.parse(req.url, true);
          
          if (reqUrl.pathname === '/oauth2callback') {
            const code = reqUrl.query.code;
            
            if (code) {
              // 獲取 tokens
              const { tokens } = await auth.getToken(code);
              
              // 發送成功頁面
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="UTF-8">
                  <title>授權成功</title>
                  <style>
                    body { 
                      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                      display: flex; 
                      justify-content: center; 
                      align-items: center; 
                      height: 100vh; 
                      margin: 0; 
                      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    }
                    .container { 
                      background: white; 
                      padding: 40px; 
                      border-radius: 20px; 
                      text-align: center; 
                      box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                      max-width: 400px;
                    }
                    .success { color: #10b981; font-size: 48px; margin-bottom: 20px; }
                    h1 { color: #1f2937; margin-bottom: 10px; }
                    p { color: #6b7280; line-height: 1.6; }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <div class="success">✅</div>
                    <h1>授權成功！</h1>
                    <p>Gmail API 已成功授權，你可以關閉此頁面。</p>
                    <p>系統將自動繼續執行...</p>
                  </div>
                </body>
                </html>
              `);
              
              server.close();
              resolve(tokens);
            } else {
              throw new Error('未收到授權碼');
            }
          }
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <title>授權失敗</title>
              <style>
                body { 
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  display: flex; 
                  justify-content: center; 
                  align-items: center; 
                  height: 100vh; 
                  margin: 0; 
                  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                }
                .container { 
                  background: white; 
                  padding: 40px; 
                  border-radius: 20px; 
                  text-align: center; 
                  box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                  max-width: 400px;
                }
                .error { color: #ef4444; font-size: 48px; margin-bottom: 20px; }
                h1 { color: #1f2937; margin-bottom: 10px; }
                p { color: #6b7280; line-height: 1.6; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="error">❌</div>
                <h1>授權失敗</h1>
                <p>發生錯誤：${error.message}</p>
                <p>請重新嘗試授權流程。</p>
              </div>
            </body>
            </html>
          `);
          server.close();
          reject(error);
        }
      });

      server.listen(PORT, () => {
        console.log(`🚀 本地授權服務器已啟動在 http://localhost:${PORT}`);
      });

      // 設置超時
      setTimeout(() => {
        server.close();
        reject(new Error('授權超時，請重新嘗試'));
      }, 300000); // 5分鐘超時
    });
    
    // 保存 tokens
    const tokenPath = path.join(__dirname, 'temp/google-tokens.json');
    const tempDir = path.dirname(tokenPath);
    
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
    
    console.log('\n✅ Gmail 重新認證成功！');
    console.log(`💾 Tokens 已保存到: ${tokenPath}`);
    
    // 測試連接
    auth.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    
    console.log(`📧 已連接郵箱: ${profile.data.emailAddress}`);
    console.log('🎉 重新認證完成，系統可以正常使用！');
    
  } catch (error) {
    console.error('❌ 重新認證失敗:', error);
    throw error;
  }
}

if (require.main === module) {
  reauthGmail().catch(console.error);
}

module.exports = { reauthGmail }; 