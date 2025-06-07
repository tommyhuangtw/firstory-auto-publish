#!/usr/bin/env node

/**
 * Firstory Podcast Automation Webhook Server
 * 用於 n8n 整合和定時發佈控制
 */

const express = require('express');
const { PodcastAutomation } = require('./src/main');
const { Logger } = require('./src/utils/logger');

const app = express();
const logger = new Logger();
const PORT = process.env.WEBHOOK_PORT || 3001;

// 中間件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 請求日誌中間件
app.use((req, res, next) => {
  logger.info(`📨 ${req.method} ${req.path} - ${req.ip}`);
  next();
});

// 儲存定時任務的 Map
const scheduledTasks = new Map();

/**
 * 延遲執行函數
 */
async function delay(minutes) {
  const ms = minutes * 60 * 1000;
  logger.info(`⏰ 等待 ${minutes} 分鐘後執行...`);
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 取消定時任務
 */
function cancelScheduledTask(taskId) {
  if (scheduledTasks.has(taskId)) {
    clearTimeout(scheduledTasks.get(taskId));
    scheduledTasks.delete(taskId);
    return true;
  }
  return false;
}

// ===================
// API 路由
// ===================

/**
 * 健康檢查
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    tasks: scheduledTasks.size
  });
});

/**
 * 立即執行上傳 (無延遲)
 */
app.post('/upload/immediate', async (req, res) => {
  try {
    logger.info('🚀 收到立即上傳請求');
    
    const automation = new PodcastAutomation();
    const result = await automation.processNextEpisode();
    
    if (result.success) {
      res.json({
        success: true,
        message: '上傳成功',
        episode: result.episodeTitle,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.error || '上傳失敗',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.error('立即上傳失敗:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 延遲上傳 (支援自訂延遲時間)
 */
app.post('/upload/delayed', async (req, res) => {
  try {
    const { delayMinutes = 10, taskId } = req.body;
    const finalTaskId = taskId || `task_${Date.now()}`;
    
    logger.info(`⏰ 收到延遲上傳請求: ${delayMinutes} 分鐘後執行 (任務ID: ${finalTaskId})`);
    
    // 立即回應 n8n
    res.json({
      success: true,
      message: `已安排 ${delayMinutes} 分鐘後執行上傳`,
      taskId: finalTaskId,
      executeAt: new Date(Date.now() + delayMinutes * 60 * 1000).toISOString(),
      timestamp: new Date().toISOString()
    });
    
    // 設定延遲任務
    const timeoutId = setTimeout(async () => {
      try {
        logger.info(`🚀 開始執行延遲任務: ${finalTaskId}`);
        
        const automation = new PodcastAutomation();
        const result = await automation.processNextEpisode();
        
        if (result.success) {
          logger.info(`✅ 延遲任務 ${finalTaskId} 執行成功: ${result.episodeTitle}`);
        } else {
          logger.error(`❌ 延遲任務 ${finalTaskId} 執行失敗: ${result.error}`);
        }
        
        // 清理任務記錄
        scheduledTasks.delete(finalTaskId);
        
      } catch (error) {
        logger.error(`💥 延遲任務 ${finalTaskId} 執行錯誤:`, error);
        scheduledTasks.delete(finalTaskId);
      }
    }, delayMinutes * 60 * 1000);
    
    // 儲存任務引用
    scheduledTasks.set(finalTaskId, timeoutId);
    
  } catch (error) {
    logger.error('延遲上傳請求處理失敗:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 取消延遲任務
 */
app.delete('/upload/delayed/:taskId', (req, res) => {
  try {
    const { taskId } = req.params;
    
    if (cancelScheduledTask(taskId)) {
      logger.info(`🗑️  已取消延遲任務: ${taskId}`);
      res.json({
        success: true,
        message: `任務 ${taskId} 已取消`,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        success: false,
        message: `找不到任務 ${taskId}`,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.error('取消任務失敗:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 查看所有計劃任務
 */
app.get('/tasks', (req, res) => {
  const tasks = Array.from(scheduledTasks.keys()).map(taskId => ({
    taskId,
    created: new Date().toISOString() // 簡化版，實際可以儲存更多詳細資訊
  }));
  
  res.json({
    success: true,
    tasks,
    count: tasks.length,
    timestamp: new Date().toISOString()
  });
});

/**
 * 測試模式上傳
 */
app.post('/upload/test', async (req, res) => {
  try {
    logger.info('🧪 收到測試上傳請求');
    
    const automation = new PodcastAutomation();
    const result = await automation.testUpload();
    
    res.json({
      success: true,
      message: '測試完成',
      result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('測試上傳失敗:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ===================
// 錯誤處理
// ===================

app.use((err, req, res, next) => {
  logger.error('服務器錯誤:', err);
  res.status(500).json({
    success: false,
    message: '內部服務器錯誤',
    timestamp: new Date().toISOString()
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'API 端點不存在',
    timestamp: new Date().toISOString()
  });
});

// ===================
// 服務器啟動
// ===================

const server = app.listen(PORT, () => {
  console.log('\n🚀 Firstory Podcast Automation Webhook Server');
  console.log('==============================================');
  console.log(`📡 服務器運行於: http://localhost:${PORT}`);
  console.log('');
  console.log('📋 可用的 API 端點:');
  console.log(`   GET  /health                    - 健康檢查`);
  console.log(`   POST /upload/immediate          - 立即上傳`);
  console.log(`   POST /upload/delayed            - 延遲上傳`);
  console.log(`   POST /upload/test               - 測試上傳`);
  console.log(`   GET  /tasks                     - 查看計劃任務`);
  console.log(`   DELETE /upload/delayed/:taskId  - 取消任務`);
  console.log('');
  console.log('🔗 n8n 整合範例:');
  console.log(`   curl -X POST http://localhost:${PORT}/upload/delayed \\`);
  console.log(`        -H "Content-Type: application/json" \\`);
  console.log(`        -d '{"delayMinutes": 10}'`);
  console.log('');
});

// 優雅關閉
process.on('SIGTERM', () => {
  logger.info('收到 SIGTERM，正在關閉服務器...');
  server.close(() => {
    logger.info('服務器已關閉');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('收到 SIGINT，正在關閉服務器...');
  
  // 取消所有計劃任務
  scheduledTasks.forEach((timeoutId, taskId) => {
    clearTimeout(timeoutId);
    logger.info(`取消任務: ${taskId}`);
  });
  scheduledTasks.clear();
  
  server.close(() => {
    logger.info('服務器已關閉');
    process.exit(0);
  });
});

module.exports = app; 