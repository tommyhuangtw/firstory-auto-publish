#!/usr/bin/env node
/**
 * 使用 Google Drive API 下載最新檔案
 * 
 * 使用方式:
 * 1. 直接提供認證資訊: node download-with-api.js --client-id="YOUR_CLIENT_ID" --client-secret="YOUR_CLIENT_SECRET"
 * 2. 使用環境變數: GOOGLE_CLIENT_ID="..." GOOGLE_CLIENT_SECRET="..." node download-with-api.js
 * 3. 使用互動模式: node download-with-api.js
 */

const { GoogleDriveAPIService } = require('./src/services/googleDriveAPI');
const readline = require('readline');

// 文件夾連結
const AUDIO_FOLDER_URL = 'https://drive.google.com/drive/folders/1pB2PaU9BAKi0IGbIgudUEm29bgPhX1jq?usp=sharing';
const IMAGE_FOLDER_URL = 'https://drive.google.com/drive/folders/1BCSiZXS8aGnMdOnfJfAbwgitFfliVbQ-?usp=drive_link';

// 解析命令列參數
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  
  for (const arg of args) {
    if (arg.startsWith('--client-id=')) {
      parsed.clientId = arg.split('=')[1];
    } else if (arg.startsWith('--client-secret=')) {
      parsed.clientSecret = arg.split('=')[1];
    } else if (arg === '--interactive' || arg === '-i') {
      parsed.interactive = true;
    }
  }
  
  return parsed;
}

// 互動式獲取認證資訊
async function getCredentialsInteractively() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    console.log('\n🔑 請提供 Google Drive API 認證資訊:');
    console.log('================================================\n');
    
    rl.question('Client ID: ', (clientId) => {
      rl.question('Client Secret: ', (clientSecret) => {
        rl.close();
        resolve({ clientId, clientSecret });
      });
    });
  });
}

// 設定授權碼的輔助函數
async function setAuthCode(code) {
  try {
    const args = parseArgs();
    let clientId = args.clientId || process.env.GOOGLE_CLIENT_ID;
    let clientSecret = args.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      const credentials = await getCredentialsInteractively();
      clientId = credentials.clientId;
      clientSecret = credentials.clientSecret;
    }
    
    const service = new GoogleDriveAPIService();
    await service.initializeClient(clientId, clientSecret);
    await service.setAuthCode(code);
    
    console.log('✅ 授權碼設定完成，現在可以執行下載了！');
    
  } catch (error) {
    console.error('❌ 設定授權碼失敗:', error.message);
  }
}

// 主要下載函數
async function downloadWithAPI() {
  console.log('🚀 使用 Google Drive API 下載最新檔案...');
  console.log('===============================================\n');
  
  try {
    const args = parseArgs();
    let clientId = args.clientId || process.env.GOOGLE_CLIENT_ID;
    let clientSecret = args.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
    
    // 如果沒有認證資訊，使用互動模式
    if (!clientId || !clientSecret) {
      if (args.interactive !== false) {
        const credentials = await getCredentialsInteractively();
        clientId = credentials.clientId;
        clientSecret = credentials.clientSecret;
      } else {
        throw new Error('請提供 Client ID 和 Client Secret');
      }
    }
    
    console.log('📁 音檔文件夾:', AUDIO_FOLDER_URL);
    console.log('📁 圖片文件夾:', IMAGE_FOLDER_URL);
    console.log('');
    
    const service = new GoogleDriveAPIService();
    
    // 下載檔案
    const result = await service.downloadLatestFiles(
      AUDIO_FOLDER_URL,
      IMAGE_FOLDER_URL,
      clientId,
      clientSecret
    );
    
    console.log('\n📋 下載結果:');
    console.log('============');
    
    if (result.audio) {
      console.log(`🎵 音檔: ${result.audio.fileName}`);
      console.log(`   路徑: ${result.audio.path}`);
      console.log(`   大小: ${formatFileSize(result.audio.size)}`);
      console.log(`   修改時間: ${new Date(result.audio.modifiedTime).toLocaleString()}`);
    }
    
    if (result.image) {
      console.log(`🖼️ 圖片: ${result.image.fileName}`);
      console.log(`   路徑: ${result.image.path}`);
      console.log(`   大小: ${formatFileSize(result.image.size)}`);
      console.log(`   修改時間: ${new Date(result.image.modifiedTime).toLocaleString()}`);
    }
    
    console.log(`\n⏰ 下載時間: ${result.timestamp}`);
    
    console.log('\n✅ 檔案下載完成！');
    console.log('\n🚀 下一步可以執行:');
    console.log('   npm run test     # 測試 Firstory 上傳');
    console.log('   npm start        # 正式上傳到 Firstory');
    
  } catch (error) {
    console.error('\n💥 下載失敗:', error.message);
    
    if (error.message.includes('需要完成 OAuth 認證流程')) {
      console.log('\n💡 OAuth 認證流程:');
      console.log('   1. 打開上面的認證連結');
      console.log('   2. 完成 Google 授權');
      console.log('   3. 複製授權碼');
      console.log('   4. 執行: node -e "require(\'./download-with-api\').setAuthCode(\'YOUR_AUTH_CODE\')"');
      console.log('   5. 重新執行此腳本');
    }
    
    process.exit(1);
  }
}

// 格式化檔案大小
function formatFileSize(bytes) {
  if (!bytes) return 'Unknown';
  
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
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

// 檢查是否為直接執行
if (require.main === module) {
  downloadWithAPI();
}

// 導出函數供其他模組使用
module.exports = { downloadWithAPI, setAuthCode }; 