#!/usr/bin/env node
/**
 * 測試 Firstory 登入功能（支援 Google 登入和 Cookie 保存）
 */

require('dotenv').config();
const { FirstoryUploader } = require('./src/firstory-uploader');

async function testLogin() {
  console.log('🚀 開始測試 Firstory 登入功能...\n');

  const uploader = new FirstoryUploader();
  
  try {
    // 初始化瀏覽器（使用持久化 session）
    console.log('📱 初始化瀏覽器（持久化模式）...');
    await uploader.initialize();
    
    // 嘗試登入
    console.log('🔐 嘗試登入 Firstory...');
    const loginSuccess = await uploader.login();
    
    if (loginSuccess) {
      console.log('✅ 登入成功！');
      
      // 檢查是否在 dashboard
      await uploader.page.goto('https://firstory.me/dashboard');
      await uploader.page.waitForLoadState('networkidle');
      
      console.log('📊 當前頁面 URL:', uploader.page.url());
      
      // 檢查登入狀態
      const isLoggedIn = await uploader.checkIfLoggedIn();
      console.log('🔍 登入狀態確認:', isLoggedIn ? '✅ 已登入' : '❌ 未登入');
      
      // 等待 10 秒讓你觀察結果
      console.log('\n⏰ 等待 10 秒讓你觀察結果...');
      await uploader.page.waitForTimeout(10000);
      
    } else {
      console.log('❌ 登入失敗');
    }
    
  } catch (error) {
    console.error('💥 測試過程發生錯誤:', error);
  } finally {
    await uploader.close();
    console.log('🔚 測試完成');
  }
}

// 執行測試
testLogin();