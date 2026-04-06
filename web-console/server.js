const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const multer = require('multer');

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

// Multer 檔案上傳設定
const uploadDir = path.join(__dirname, 'temp', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB
});

// 中間件
app.use(express.json());
app.use(express.static('public'));

// 狀態追蹤
let currentProcess = null;
let processStatus = 'idle';

// 手動上傳 session 管理
const manualSessions = new Map();

// 檢查是否有任何流程在執行中
function isAnyProcessRunning() {
  if (currentProcess) return true;
  for (const [, session] of manualSessions) {
    if (session.status === 'generating' || session.status === 'uploading') return true;
  }
  return false;
}

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
  if (isAnyProcessRunning()) {
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

// ═══════════════════════════════════════════════════
// 手動上傳 API
// ═══════════════════════════════════════════════════

// Phase A: 上傳檔案 + 生成 AI 內容
app.post('/api/manual-upload/generate',
  upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'cover', maxCount: 1 }
  ]),
  async (req, res) => {
    if (isAnyProcessRunning()) {
      return res.status(400).json({
        status: 'error',
        message: '已有流程在執行中，請等待完成後再試'
      });
    }

    const sessionId = 'manual-' + Date.now();

    try {
      const audioFile = req.files?.audio?.[0];
      const coverFile = req.files?.cover?.[0];
      const scriptText = req.body?.script;
      const segment = req.body?.segment || null;

      if (!audioFile) {
        return res.status(400).json({ status: 'error', message: '請上傳音檔' });
      }
      if (!coverFile) {
        return res.status(400).json({ status: 'error', message: '請上傳封面圖' });
      }
      if (!scriptText || scriptText.trim().length === 0) {
        return res.status(400).json({ status: 'error', message: '請輸入講稿/重點文字' });
      }

      // 建立 session
      manualSessions.set(sessionId, {
        status: 'generating',
        audioPath: audioFile.path,
        coverPath: coverFile.path,
        scriptText,
        segment,
        logs: ['📤 檔案上傳完成，開始生成 AI 內容...'],
        createdAt: new Date()
      });

      console.log(`🎙️ 手動上傳 session ${sessionId} 開始生成...`);

      // 動態載入 manual-upload-flow（避免啟動時就載入所有依賴）
      const { generateContent } = require('../manual-upload-flow');

      const result = await generateContent({
        audioPath: audioFile.path,
        coverPath: coverFile.path,
        scriptText,
        segment
      });

      // 更新 session
      const session = manualSessions.get(sessionId);
      session.status = 'awaiting_confirmation';
      session.generateResult = result;
      session.logs.push('✅ AI 內容生成完成');

      res.json({
        status: 'success',
        sessionId,
        candidateTitles: result.candidateTitles,
        titlesWithEpisodeNumber: result.titlesWithEpisodeNumber,
        bestTitleIndex: result.bestTitleIndex,
        description: result.description,
        tags: result.tags,
        episodeNumber: result.episodeNumber
      });

    } catch (error) {
      console.error(`❌ 手動上傳生成失敗 (${sessionId}):`, error);
      const session = manualSessions.get(sessionId);
      if (session) {
        session.status = 'failed';
        session.error = error.message;
        session.logs.push(`❌ 生成失敗: ${error.message}`);
      }
      res.status(500).json({
        status: 'error',
        sessionId,
        message: error.message
      });
    }
  }
);

// Phase B: 確認描述後執行上傳
app.post('/api/manual-upload/confirm', async (req, res) => {
  const { sessionId, editedDescription } = req.body;

  if (!sessionId || !manualSessions.has(sessionId)) {
    return res.status(400).json({ status: 'error', message: '無效的 session ID' });
  }

  const session = manualSessions.get(sessionId);
  if (session.status !== 'awaiting_confirmation') {
    return res.status(400).json({ status: 'error', message: `Session 狀態不正確: ${session.status}` });
  }

  if (isAnyProcessRunning()) {
    return res.status(400).json({
      status: 'error',
      message: '已有流程在執行中，請等待完成後再試'
    });
  }

  // 標記為上傳中
  session.status = 'uploading';
  session.currentStep = 'init';
  session.logs.push('🚀 開始上傳流程...');

  // 立即回應，在背景執行上傳
  res.json({ status: 'started', sessionId });

  // 背景執行上傳
  (async () => {
    try {
      const { executeUpload } = require('../manual-upload-flow');

      const result = await executeUpload({
        generateResult: session.generateResult,
        editedDescription: editedDescription || session.generateResult.description,
        onProgress: (step, message) => {
          session.currentStep = step;
          session.logs.push(message);
        }
      });

      session.status = 'completed';
      session.result = result;
      session.logs.push('🎉 全部流程完成！');

      // 10分鐘後清理 session
      setTimeout(() => {
        cleanupSession(sessionId);
      }, 10 * 60 * 1000);

    } catch (error) {
      session.status = 'failed';
      session.error = error.message;
      session.logs.push(`❌ 上傳失敗: ${error.message}`);

      // 5分鐘後清理 session
      setTimeout(() => {
        cleanupSession(sessionId);
      }, 5 * 60 * 1000);
    }
  })();
});

// 查詢手動上傳進度
app.get('/api/manual-upload/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = manualSessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ status: 'error', message: 'Session 不存在' });
  }

  res.json({
    status: session.status,
    currentStep: session.currentStep || null,
    logs: session.logs,
    result: session.result || null,
    error: session.error || null,
    youtubeUrl: session.result?.youtubeUrl || null
  });
});

// 清理 session 和上傳的臨時檔案
function cleanupSession(sessionId) {
  const session = manualSessions.get(sessionId);
  if (!session) return;

  try {
    if (session.audioPath && fs.existsSync(session.audioPath)) {
      fs.unlinkSync(session.audioPath);
    }
    if (session.coverPath && fs.existsSync(session.coverPath)) {
      fs.unlinkSync(session.coverPath);
    }
  } catch (e) {
    console.log(`⚠️ 清理 session ${sessionId} 臨時檔案失敗:`, e.message);
  }

  manualSessions.delete(sessionId);
  console.log(`🗑️ Session ${sessionId} 已清理`);
}

// ═══════════════════════════════════════════════════

// 標題選擇端點 (代理到你現有的服務)
app.get('/select', (req, res) => {
  const index = parseInt(req.query.index) || 0;

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
