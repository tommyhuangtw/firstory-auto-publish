const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// 載入父目錄的 .env 檔案
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.WEB_CONSOLE_PORT || 8888;

// 動態獲取當前的PUBLIC_URL
function getCurrentPublicUrl() {
  // 重新讀取.env檔案以獲取最新的PUBLIC_URL
  try {
    const envPath = path.join(__dirname, '../.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const urlMatch = envContent.match(/PUBLIC_URL=(.+)/);
    
    if (urlMatch && urlMatch[1] && urlMatch[1] !== `http://localhost:${PORT}`) {
      return urlMatch[1];
    }
  } catch (error) {
    console.log('⚠️ 無法讀取.env檔案，使用預設URL');
  }
  
  return `http://localhost:${PORT}`;
}

const PUBLIC_URL = getCurrentPublicUrl();

// 中間件
app.use(express.json());
app.use(express.static('public'));

// 狀態追蹤
let currentProcess = null;
let processStatus = 'idle';

// 主控台頁面
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 健康檢查
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    currentProcess: processStatus
  });
});

// 獲取狀態
app.get('/api/status', (req, res) => {
  res.json({
    status: processStatus,
    hasActiveProcess: currentProcess !== null,
    timestamp: new Date().toISOString()
  });
});

// 啟動上傳流程
app.post('/api/start-upload', (req, res) => {
  if (currentProcess) {
    return res.status(400).json({
      status: 'error',
      message: '已有流程在執行中'
    });
  }

  try {
    console.log('🚀 啟動 Podcast 上傳流程...');
    
    // 執行你現有的 interactive-soundon-flow.js
    currentProcess = spawn('node', ['../interactive-soundon-flow.js'], {
      cwd: __dirname,
      stdio: 'pipe',
      env: { 
        ...process.env,
        PUBLIC_URL: getCurrentPublicUrl(),  // 動態獲取最新的公網URL
        WEB_CONSOLE_MODE: 'true' // 標記這是從Web控制台觸發的
      }
    });

    processStatus = 'running';

    // 監聽進程輸出
    currentProcess.stdout.on('data', (data) => {
      console.log(`📝 輸出: ${data}`);
    });

    currentProcess.stderr.on('data', (data) => {
      console.error(`❌ 錯誤: ${data}`);
    });

    // 進程結束
    currentProcess.on('close', (code) => {
      console.log(`✅ 流程結束，退出碼: ${code}`);
      currentProcess = null;
      processStatus = code === 0 ? 'completed' : 'failed';
      
      // 5分鐘後重置狀態
      setTimeout(() => {
        processStatus = 'idle';
      }, 5 * 60 * 1000);
    });

    res.json({
      status: 'started',
      message: '🚀 Podcast上傳流程已啟動',
      processId: Date.now()
    });

  } catch (error) {
    console.error('啟動流程失敗:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// 停止流程
app.post('/api/stop-upload', (req, res) => {
  if (currentProcess) {
    currentProcess.kill();
    currentProcess = null;
    processStatus = 'stopped';
    
    res.json({
      status: 'stopped',
      message: '流程已停止'
    });
  } else {
    res.json({
      status: 'no_process',
      message: '沒有正在執行的流程'
    });
  }
});

// 標題選擇端點 (代理到你現有的服務)
app.get('/select', (req, res) => {
  const index = parseInt(req.query.index) || 0;
  
  // 這裡可以轉發到你現有的標題選擇邏輯
  // 或者直接返回確認頁面
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>標題選擇確認</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background: linear-gradient(135deg, #10b981, #059669);
          margin: 0;
          padding: 20px;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .card {
          background: white;
          border-radius: 15px;
          padding: 30px;
          text-align: center;
          box-shadow: 0 10px 30px rgba(0,0,0,0.2);
          max-width: 400px;
        }
        .success { color: #059669; font-size: 24px; margin-bottom: 20px; }
        .message { font-size: 18px; margin-bottom: 20px; }
        .info { color: #666; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="success">✅ 標題選擇成功！</div>
        <div class="message">您已選擇標題 #${index + 1}</div>
        <div class="info">
          🚀 系統正在處理後續作業...<br>
          ⏰ ${new Date().toLocaleString()}<br>
          💻 Web控制台版本
        </div>
      </div>
      <script>
        setTimeout(() => window.close(), 5000);
      </script>
    </body>
    </html>
  `);
});

// 啟動服務器
app.listen(PORT, () => {
  console.log(`🌐 Web控制台啟動成功！`);
  console.log(`📍 本地訪問: http://localhost:${PORT}`);
  console.log(`🌍 公開訪問: ${PUBLIC_URL}`);
  console.log(`📊 狀態: ${processStatus}`);
  console.log(`⏰ 啟動時間: ${new Date().toLocaleString()}`);
});