const express = require('express');
const path = require('path');

class TitleSelectionServer {
  constructor() {
    this.app = express();
    this.server = null;
    this.port = null;
    this.selectedTitle = null;
    this.selectionPromise = null;
    this.resolveSelection = null;
    // 縮圖選擇
    this.selectedThumbnail = null;
    this.resolveThumbnailSelection = null;
  }

  async start() {
    this.setupRoutes();

    const startPort = 3001;
    const maxAttempts = 10;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const port = startPort + attempt;
      try {
        await new Promise((resolve, reject) => {
          const server = this.app.listen(port, () => resolve());
          server.on('error', (err) => reject(err));
          this.server = server;
        });
        this.port = port;
        return this.port;
      } catch (err) {
        if (err.code === 'EADDRINUSE' && attempt < maxAttempts - 1) {
          console.log(`⚠️ 端口 ${port} 已被佔用，嘗試端口 ${port + 1}...`);
          continue;
        }
        throw err;
      }
    }
  }

  setupRoutes() {
    // 處理標題選擇
    this.app.get('/select', (req, res) => {
      const index = parseInt(req.query.index);
      
      if (isNaN(index)) {
        res.status(400).send('無效的標題索引');
        return;
      }

      // 保存選擇的標題索引
      this.selectedTitle = {
        index: index,
        timestamp: new Date()
      };

      // 返回確認頁面
      res.send(this.generateConfirmationHTML(index));

      // 解析等待中的 Promise
      if (this.resolveSelection) {
        this.resolveSelection(this.selectedTitle);
      }
    });

    // 縮圖選擇端點
    this.app.get('/select-thumbnail', (req, res) => {
      const index = parseInt(req.query.index);

      if (isNaN(index)) {
        res.status(400).send('無效的縮圖索引');
        return;
      }

      this.selectedThumbnail = { index, timestamp: new Date() };

      res.send(this.generateThumbnailConfirmationHTML(index));

      if (this.resolveThumbnailSelection) {
        this.resolveThumbnailSelection(this.selectedThumbnail);
      }
    });

    // 縮圖圖片靜態服務（供 Email 預覽）
    this.app.use('/thumbnails', express.static(path.join(__dirname, '../../temp')));

    // 健康檢查端點
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', port: this.port });
    });
  }

  generateConfirmationHTML(selectedIndex) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>選擇確認 - AI懶人報</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #10b981 0%, #059669 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center;">
      <div style="max-width: 500px; margin: 0 auto; padding: 40px 20px;">
        
        <!-- Success Card -->
        <div style="background: white; border-radius: 20px; padding: 40px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.1);">
          
          <!-- Success Icon -->
          <div style="font-size: 64px; margin-bottom: 20px;">
            ✅
          </div>
          
          <!-- Title -->
          <h1 style="color: #065f46; font-size: 28px; font-weight: 700; margin: 0 0 15px 0;">
            選擇成功！
          </h1>
          
          <!-- Message -->
          <p style="color: #047857; font-size: 18px; margin: 0 0 30px 0; font-weight: 500;">
            您已選擇標題 #${selectedIndex + 1}
          </p>
          
          <!-- Status -->
          <div style="background: #d1fae5; border: 2px solid #10b981; border-radius: 12px; padding: 20px; margin-bottom: 30px;">
            <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 10px;">
              <span style="font-size: 20px; margin-right: 10px;">🚀</span>
              <strong style="color: #065f46; font-size: 16px;">系統狀態</strong>
            </div>
            <p style="color: #047857; margin: 0; font-size: 14px;">
              正在啟動自動上傳流程，請稍候...
            </p>
          </div>
          
          <!-- Instructions -->
          <div style="background: #f3f4f6; border-radius: 12px; padding: 20px;">
            <p style="color: #374151; font-size: 14px; margin: 0; line-height: 1.5;">
              📱 您可以關閉此頁面<br>
              🎙️ 系統將自動完成後續上傳作業<br>
              ⏰ 整個流程大約需要 3-5 分鐘
            </p>
          </div>
          
          <!-- Footer -->
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">
              🤖 AI懶人報自動化系統 | 感謝您的選擇
            </p>
          </div>
        </div>
      </div>
      
      <!-- Auto-close script -->
      <script>
        // 5秒後自動關閉頁面
        setTimeout(() => {
          window.close();
        }, 5000);
      </script>
    </body>
    </html>
    `;
  }

  async waitForSelection() {
    return new Promise((resolve) => {
      this.resolveSelection = (selectedData) => {
        resolve({
          index: selectedData.index,
          title: null,
          timestamp: selectedData.timestamp
        });
      };
    });
  }

  async waitForThumbnailSelection() {
    return new Promise((resolve) => {
      this.resolveThumbnailSelection = (selectedData) => {
        resolve({
          index: selectedData.index,
          timestamp: selectedData.timestamp
        });
      };
    });
  }

  generateThumbnailConfirmationHTML(selectedIndex) {
    const labels = ['純白經典', '奶油暖色', '暖色變體'];
    const label = labels[selectedIndex] || `方案 ${selectedIndex + 1}`;
    return `
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>縮圖選擇確認 - AI懶人報</title></head>
    <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#e8c66a 0%,#d4a44a 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;">
      <div style="max-width:500px;margin:0 auto;padding:40px 20px;">
        <div style="background:white;border-radius:20px;padding:40px;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.1);">
          <div style="font-size:64px;margin-bottom:20px;">🖼️</div>
          <h1 style="color:#2c2417;font-size:28px;font-weight:700;margin:0 0 15px 0;">縮圖選擇成功！</h1>
          <p style="color:#6b5b3e;font-size:18px;margin:0 0 30px 0;font-weight:500;">您選擇了「${label}」風格</p>
          <div style="background:#fef3c7;border:2px solid #e8c66a;border-radius:12px;padding:20px;margin-bottom:20px;">
            <p style="color:#92400e;margin:0;font-size:14px;">🚀 系統將使用此縮圖上傳到 YouTube</p>
          </div>
          <p style="color:#9ca3af;font-size:12px;">🤖 AI懶人報自動化系統</p>
        </div>
      </div>
      <script>setTimeout(()=>window.close(),5000);</script>
    </body></html>`;
  }

  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log(`🛑 標題選擇服務器已關閉 (端口 ${this.port})`);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = { TitleSelectionServer }; 