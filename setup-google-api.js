#!/usr/bin/env node
/**
 * Google Drive API 設定輔助工具
 */

const readline = require('readline');
const fs = require('fs-extra');
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function setupGoogleAPI() {
  console.log('🚀 Google Drive API 設定輔助工具');
  console.log('=====================================\n');
  
  console.log('📋 設定前準備:');
  console.log('1. 前往 Google Cloud Console: https://console.cloud.google.com/');
  console.log('2. 創建新專案或選擇現有專案');
  console.log('3. 啟用 Google Drive API');
  console.log('4. 創建 OAuth 2.0 Desktop Application 認證');
  console.log('');
  
  const hasSetup = await question('✅ 已完成上述準備步驟了嗎？(y/n): ');
  
  if (hasSetup.toLowerCase() !== 'y') {
    console.log('\n📖 詳細設定指南請參考: GOOGLE_API_SETUP.md');
    console.log('完成設定後請重新執行此腳本。');
    rl.close();
    return;
  }
  
  console.log('\n🔑 請輸入你的 Google API 認證資訊:');
  console.log('（這些資訊可以在 Google Cloud Console > APIs & Services > Credentials 中找到）');
  console.log('');
  
  const clientId = await question('Client ID: ');
  const clientSecret = await question('Client Secret: ');
  
  if (!clientId || !clientSecret) {
    console.log('❌ Client ID 和 Client Secret 都是必需的');
    rl.close();
    return;
  }
  
  console.log('\n💾 儲存方式選擇:');
  console.log('1. 儲存到 .env 檔案（推薦）');
  console.log('2. 僅顯示命令，不儲存');
  
  const saveOption = await question('選擇 (1 或 2): ');
  
  if (saveOption === '1') {
    // 儲存到 .env 檔案
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    
    // 如果 .env 檔案已存在，讀取現有內容
    if (await fs.pathExists(envPath)) {
      envContent = await fs.readFile(envPath, 'utf8');
    }
    
    // 移除舊的 Google 認證設定（如果存在）
    envContent = envContent.replace(/^GOOGLE_CLIENT_ID=.*$/gm, '');
    envContent = envContent.replace(/^GOOGLE_CLIENT_SECRET=.*$/gm, '');
    
    // 添加新的設定
    envContent += `\n# Google Drive API 認證\n`;
    envContent += `GOOGLE_CLIENT_ID=${clientId}\n`;
    envContent += `GOOGLE_CLIENT_SECRET=${clientSecret}\n`;
    
    await fs.writeFile(envPath, envContent.trim() + '\n');
    
    console.log('\n✅ 認證資訊已儲存到 .env 檔案');
    console.log('\n🚀 現在你可以執行:');
    console.log('   npm run download-api    # 使用 API 下載檔案');
    
  } else {
    console.log('\n📋 使用命令:');
    console.log(`node download-with-api.js --client-id="${clientId}" --client-secret="${clientSecret}"`);
  }
  
  console.log('\n💡 第一次使用時需要完成 OAuth 認證：');
  console.log('1. 執行下載命令');
  console.log('2. 打開顯示的認證連結');
  console.log('3. 完成 Google 授權');
  console.log('4. 複製授權碼');
  console.log('5. 執行設定授權碼的命令');
  console.log('6. 重新執行下載命令');
  
  console.log('\n📖 詳細說明請參考: GOOGLE_API_SETUP.md');
  
  rl.close();
}

async function main() {
  try {
    await setupGoogleAPI();
  } catch (error) {
    console.error('❌ 設定過程中發生錯誤:', error.message);
    rl.close();
  }
}

if (require.main === module) {
  main();
} 