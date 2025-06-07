#!/usr/bin/env node

/**
 * Firstory Podcast Automation Runner
 * 
 * 使用方式:
 * node run-automation.js [mode]
 * 
 * 模式:
 * - once: 執行一次完整流程 (預設)
 * - test: 測試模式
 * - scheduled: 定時執行模式
 * - cleanup: 清理舊檔案
 */

const { PodcastAutomation } = require('./src/main');
const { Logger } = require('./src/utils/logger');

const logger = new Logger();

async function showStatus() {
  console.log('\n🤖 Firstory Podcast Automation');
  console.log('================================');
  console.log('');
  console.log('📊 服務狀態檢查:');
  
  // 檢查基本環境變數
  const requiredEnvs = [
    'GEMINI_API_KEY',
    'AIRTABLE_API_KEY',
    'AIRTABLE_BASE_ID'
  ];
  
  const missingEnvs = requiredEnvs.filter(env => !process.env[env]);
  
  if (missingEnvs.length > 0) {
    console.log('❌ 缺少環境變數:');
    missingEnvs.forEach(env => console.log(`   - ${env}`));
    console.log('');
    console.log('請檢查 .env 檔案設定');
    console.log('');
    return false;
  }
  
  console.log('✅ 基本環境變數設定完整');
  
  // 檢查 Google Drive 設定 - 優先使用 API，然後檢查舊的 URL 方式
  const hasGoogleDriveAPI = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET;
  const hasGoogleDriveURLs = process.env.GOOGLE_DRIVE_AUDIO_URL && process.env.GOOGLE_DRIVE_COVER_URL;
  
  if (hasGoogleDriveAPI) {
    console.log('✅ Google Drive API 設定完整');
    
    // 檢查是否已經完成 OAuth 認證
    const fs = require('fs-extra');
    const path = require('path');
    const tokenFile = path.join(__dirname, 'google-token.json');
    
    if (await fs.pathExists(tokenFile)) {
      console.log('✅ Google Drive API 認證完成');
    } else {
      console.log('⚠️  Google Drive API 需要認證');
      console.log('   請執行: npm run oauth-simple');
      console.log('');
      return false;
    }
  } else if (hasGoogleDriveURLs) {
    console.log('⚠️  使用舊版 Google Drive URL 方式');
    console.log('   建議升級到 Google Drive API');
    
    // 檢查 Google Drive 連結格式
    const audioUrl = process.env.GOOGLE_DRIVE_AUDIO_URL;
    const coverUrl = process.env.GOOGLE_DRIVE_COVER_URL;
    
    const isDriveUrl = (url) => url && url.includes('drive.google.com');
    
    if (!isDriveUrl(audioUrl)) {
      console.log('❌ 音檔連結格式不正確');
      console.log(`   當前: ${audioUrl}`);
      return false;
    } else {
      console.log('✅ 音檔連結格式正確');
    }
    
    if (!isDriveUrl(coverUrl)) {
      console.log('❌ 封面連結格式不正確');
      console.log(`   當前: ${coverUrl}`);
      return false;
    } else {
      console.log('✅ 封面連結格式正確');
    }
  } else {
    console.log('❌ 缺少 Google Drive 設定');
    console.log('');
    console.log('🔗 請選擇以下其中一種方式:');
    console.log('');
    console.log('📋 方式 1: Google Drive API (推薦)');
    console.log('   1. 執行: npm run setup-google-api');
    console.log('   2. 按照指示設定 API 憑證');
    console.log('   3. 執行: npm run oauth-simple');
    console.log('');
    console.log('📋 方式 2: 舊版 URL 方式');
    console.log('   設定以下環境變數:');
    console.log('   - GOOGLE_DRIVE_AUDIO_URL');
    console.log('   - GOOGLE_DRIVE_COVER_URL');
    console.log('');
    return false;
  }
  
  console.log('✅ 所有服務準備就緒');
  console.log('');
  return true;
}

function showUsage() {
  console.log('使用方式:');
  console.log('  node run-automation.js [mode]');
  console.log('');
  console.log('可用模式:');
  console.log('  once       執行一次完整流程 (預設)');
  console.log('  test       測試模式，不會實際上傳');
  console.log('  scheduled  定時執行模式');
  console.log('  cleanup    清理舊的臨時檔案');
  console.log('  status     顯示系統狀態');
  console.log('');
  console.log('範例:');
  console.log('  node run-automation.js once');
  console.log('  node run-automation.js test');
  console.log('  node run-automation.js scheduled');
}

async function main() {
  const mode = process.argv[2] || 'once';
  
  // 顯示狀態
  if (mode === 'status') {
    await showStatus();
    return;
  }
  
  if (mode === 'help' || mode === '--help' || mode === '-h') {
    showUsage();
    return;
  }
  
  // 檢查系統狀態
  const statusOk = await showStatus();
  if (!statusOk) {
    process.exit(1);
  }
  
  const automation = new PodcastAutomation();
  
  try {
    console.log(`🚀 啟動模式: ${mode}`);
    console.log('');
    
    switch (mode) {
      case 'once':
        logger.info('執行單次完整流程...');
        const result = await automation.processNextEpisode();
        if (result.success) {
          console.log('\n🎉 執行成功！');
          console.log(`📝 已上傳: ${result.episodeTitle}`);
          if (result.warning) {
            console.log(`⚠️  警告: ${result.warning}`);
          }
        }
        break;
        
      case 'test':
        logger.info('執行測試模式...');
        const testResult = await automation.testUpload();
        console.log('\n🎉 測試完成！');
        console.log(testResult);
        break;
        
      case 'scheduled':
        logger.info('啟動定時執行模式...');
        automation.startScheduledUpload();
        console.log('\n⏰ 定時器已啟動，按 Ctrl+C 停止');
        
        // 保持程序運行
        process.stdin.resume();
        break;
        
      case 'cleanup':
        logger.info('執行清理作業...');
        await automation.cleanup();
        console.log('\n🗑️  清理完成！');
        break;
        
      default:
        console.error(`❌ 未知模式: ${mode}`);
        showUsage();
        process.exit(1);
    }
    
    if (mode !== 'scheduled') {
      console.log('\n✅ 所有作業完成');
      process.exit(0);
    }
    
  } catch (error) {
    console.error('\n💥 執行失敗:');
    console.error(error.message);
    
    if (process.env.NODE_ENV === 'development') {
      console.error('\n詳細錯誤:');
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

// 處理未捕獲的錯誤
process.on('unhandledRejection', (reason, promise) => {
  console.error('未處理的 Promise 拒絕:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('未捕獲的例外:', error);
  process.exit(1);
});

// 處理程序終止
process.on('SIGINT', () => {
  console.log('\n🛑 收到中斷信號，正在停止...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 收到終止信號，正在停止...');
  process.exit(0);
});

// 執行主函數
if (require.main === module) {
  main();
}

module.exports = { main }; 