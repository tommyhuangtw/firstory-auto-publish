const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class GmailService {
  constructor() {
    this.gmail = null;
    this.auth = null;
  }

  async initializeAuth() {
    try {
      console.log('🔍 載入 Gmail 專用 tokens...');
      
      const credentials = {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uris: [process.env.GOOGLE_REDIRECT_URI]
      };

      this.auth = new google.auth.OAuth2(
        credentials.client_id,
        credentials.client_secret,
        credentials.redirect_uris[0]
      );

      // 檢查是否有保存的 tokens
      const tokenPath = path.join(__dirname, '../../temp/google-tokens.json');
      if (fs.existsSync(tokenPath)) {
        const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
        this.auth.setCredentials(tokens);
        console.log('✅ 使用已保存的 Gmail tokens 認證成功');
      } else {
        throw new Error('找不到 Gmail tokens，請先執行認證');
      }

      this.gmail = google.gmail({ version: 'v1', auth: this.auth });
      console.log('✅ Gmail 認證成功');
      
    } catch (error) {
      console.error('❌ Gmail 認證失敗:', error);
      throw error;
    }
  }

  async sendTitleConfirmationEmail(candidateTitles, description, serverPort, episodeNumber) {
    try {
      const recipientEmail = process.env.RECIPIENT_EMAIL;
      if (!recipientEmail) {
        throw new Error('未設定收件人郵箱 (RECIPIENT_EMAIL)');
      }

      // 生成包含日期和集數的郵件標題
      const today = new Date();
      const month = today.getMonth() + 1; // 月份從0開始，所以要+1
      const day = today.getDate();
      const emailSubject = `🎙️ ${month}月${day}日 EP${episodeNumber} - AI懶人報標題選擇`;
      
      const emailBody = this.generateEmailHTML(candidateTitles, description, serverPort, episodeNumber, month, day);

      // 構建郵件內容，使用正確的 UTF-8 編碼
      const message = [
        `To: ${recipientEmail}`,
        `Subject: =?UTF-8?B?${Buffer.from(emailSubject).toString('base64')}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(emailBody).toString('base64')
      ].join('\n');

      const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage
        }
      });

      console.log(`✅ 標題確認郵件已發送到: ${recipientEmail}`);
      
    } catch (error) {
      console.error('❌ 發送郵件失敗:', error);
      throw error;
    }
  }

  generateEmailHTML(candidateTitles, description, serverPort, episodeNumber, month, day) {
    const titleButtons = candidateTitles.map((title, index) => `
      <div style="margin: 15px 0;">
        <a href="http://localhost:${serverPort}/select?index=${index}" 
           style="display: block; 
                  background: white; 
                  color: #1e293b; 
                  padding: 20px; 
                  text-decoration: none; 
                  border-radius: 12px; 
                  border: 2px solid #e2e8f0; 
                  font-weight: 600; 
                  font-size: 16px; 
                  text-align: center; 
                  transition: all 0.3s ease; 
                  box-shadow: 0 2px 4px rgba(0,0,0,0.1);"
           onmouseover="this.style.borderColor='#3b82f6'; this.style.boxShadow='0 4px 12px rgba(59,130,246,0.3)'; this.style.transform='translateY(-2px)';"
           onmouseout="this.style.borderColor='#e2e8f0'; this.style.boxShadow='0 2px 4px rgba(0,0,0,0.1)'; this.style.transform='translateY(0)';">
          ${title}
        </a>
      </div>
    `).join('');

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>AI懶人報 - 標題選擇</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        
        <!-- Header -->
        <div style="text-align: center; margin-bottom: 40px;">
          <h1 style="color: white; font-size: 32px; font-weight: 700; margin: 0 0 10px 0; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">
            🎙️ AI懶人報
          </h1>
          <p style="color: rgba(255,255,255,0.9); font-size: 18px; margin: 0 0 5px 0; font-weight: 500;">
            ${month}月${day}日 EP${episodeNumber} 標題選擇
          </p>
          <p style="color: rgba(255,255,255,0.8); font-size: 14px; margin: 0;">
            請選擇今日最佳標題
          </p>
        </div>

        <!-- Main Card -->
        <div style="background: rgba(255,255,255,0.95); border-radius: 20px; padding: 40px; box-shadow: 0 20px 40px rgba(0,0,0,0.1); backdrop-filter: blur(10px);">
          
          <!-- Episode Info -->
          <div style="background: #3b82f6; color: white; border-radius: 12px; padding: 20px; margin-bottom: 30px; text-align: center;">
            <div style="font-size: 24px; font-weight: 700; margin-bottom: 5px;">
              EP${episodeNumber}
            </div>
            <div style="font-size: 16px; opacity: 0.9;">
              ${month}月${day}日 播出
            </div>
          </div>
          
          <!-- Statistics -->
          <div style="display: flex; justify-content: space-around; margin-bottom: 30px; text-align: center;">
            <div style="background: #f8fafc; padding: 15px 20px; border-radius: 12px; border: 1px solid #e2e8f0;">
              <div style="font-size: 24px; font-weight: 700; color: #1e293b; margin-bottom: 5px;">
                ${candidateTitles.length}
              </div>
              <div style="font-size: 14px; color: #64748b; font-weight: 500;">
                候選標題
              </div>
            </div>
            <div style="background: #f8fafc; padding: 15px 20px; border-radius: 12px; border: 1px solid #e2e8f0;">
              <div style="font-size: 24px; font-weight: 700; color: #1e293b; margin-bottom: 5px;">
                AI
              </div>
              <div style="font-size: 14px; color: #64748b; font-weight: 500;">
                智能生成
              </div>
            </div>
          </div>

          <!-- Notice -->
          <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 12px; padding: 20px; margin-bottom: 30px;">
            <div style="display: flex; align-items: center; margin-bottom: 10px;">
              <span style="font-size: 20px; margin-right: 10px;">⚡</span>
              <strong style="color: #92400e; font-size: 16px;">重要提醒</strong>
            </div>
            <p style="color: #92400e; margin: 0; font-size: 14px; line-height: 1.5;">
              點擊下方任一標題即可確認選擇，系統將自動開始上傳流程。如果2分鐘內未選擇，將自動使用AI推薦的最佳標題。
            </p>
          </div>

          <!-- Content Description -->
          <div style="background: #f1f5f9; border-radius: 12px; padding: 20px; margin-bottom: 30px; border: 1px solid #e2e8f0;">
            <h3 style="color: #1e293b; font-size: 18px; font-weight: 600; margin: 0 0 15px 0;">
              📝 今日內容摘要
            </h3>
            <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0;">
              ${description || '今日 AI 科技新聞精選，為您帶來最新的人工智能發展動態。'}
            </p>
          </div>

          <!-- Title Selection -->
          <h3 style="color: #1e293b; font-size: 20px; font-weight: 600; margin: 0 0 20px 0; text-align: center;">
            🎯 請選擇標題
          </h3>
          
          ${titleButtons}

          <!-- Footer -->
          <div style="text-align: center; margin-top: 40px; padding-top: 30px; border-top: 2px solid #e2e8f0;">
            <p style="color: #64748b; font-size: 12px; margin: 0; line-height: 1.5;">
              🤖 由 AI 自動生成 | 📧 自動化郵件系統<br>
              選擇後將自動開始 SoundOn 上傳流程 | ⏰ 2分鐘後自動選擇AI推薦標題
            </p>
          </div>
        </div>
      </div>
    </body>
    </html>
    `;
  }
}

module.exports = { GmailService }; 