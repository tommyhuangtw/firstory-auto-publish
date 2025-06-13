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
  }

  async start() {
    return new Promise((resolve, reject) => {
      // 找一個可用的端口
      this.port = 3000;
      
      // 設置路由
      this.setupRoutes();
      
      // 啟動服務器
      this.server = this.app.listen(this.port, (error) => {
        if (error) {
          // 如果端口被占用，嘗試下一個端口
          if (error.code === 'EADDRINUSE') {
            this.port++;
            this.server = this.app.listen(this.port, (retryError) => {
              if (retryError) {
                reject(retryError);
              } else {
                resolve(this.port);
              }
            });
          } else {
            reject(error);
          }
        } else {
          resolve(this.port);
        }
      });
    });
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
        // 這裡需要從原始的候選標題列表中獲取實際的標題
        // 由於我們只有索引，需要在調用時傳入標題列表
        resolve({
          index: selectedData.index,
          title: null, // 將在外部設置
          timestamp: selectedData.timestamp
        });
      };
    });
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