#!/usr/bin/env node
/**
 * 快速測試腳本 - 驗證 Firstory 自動化系統各個組件
 */

require('dotenv').config();
const { AirtableService } = require('./src/services/airtable');
const { LLMService } = require('./src/services/llm');
const { Logger } = require('./src/utils/logger');

const logger = new Logger();

async function runQuickTest() {
  console.log('🚀 開始 Firstory 自動化系統快速測試...\n');

  // 測試 1: 環境變數檢查
  console.log('📋 1. 環境變數檢查');
  const requiredEnvs = [
    'FIRSTORY_EMAIL',
    'FIRSTORY_PASSWORD', 
    'AIRTABLE_API_KEY',
    'AIRTABLE_BASE_ID',
    'GEMINI_API_KEY'
  ];

  let envOk = true;
  for (const env of requiredEnvs) {
    if (process.env[env]) {
      console.log(`   ✅ ${env}: 已設定`);
    } else {
      console.log(`   ❌ ${env}: 未設定`);
      envOk = false;
    }
  }

  if (!envOk) {
    console.log('\n❌ 環境變數設定不完整，請檢查 .env 檔案');
    process.exit(1);
  }

  // 測試 2: Airtable 連接
  console.log('\n📊 2. 測試 Airtable 連接');
  try {
    const airtable = new AirtableService();
    const data = await airtable.getLatestPodcastData();
    
    if (data && data.emailHtml) {
      console.log('   ✅ Airtable 連接成功');
      console.log(`   📄 獲取到內容長度: ${data.emailHtml.length} 字元`);
      console.log(`   📅 資料 ID: ${data.id}`);
    } else {
      console.log('   ⚠️  Airtable 連接成功，但沒有找到有效的 Email html 內容');
    }
  } catch (error) {
    console.log(`   ❌ Airtable 連接失敗: ${error.message}`);
    return;
  }

  // 測試 3: LLM 服務
  console.log('\n🤖 3. 測試 LLM 內容生成');
  try {
    const llm = new LLMService();
    const airtable = new AirtableService();
    const episodeData = await airtable.getLatestPodcastData();
    
    if (episodeData?.emailHtml) {
      console.log('   🔄 生成標題候選中...');
      const content = await llm.generateEpisodeContent(episodeData);
      
      console.log('   ✅ LLM 內容生成成功');
      console.log(`   🏆 最佳標題: ${content.title}`);
      console.log(`   📝 描述長度: ${content.description.length} 字元`);
      console.log(`   📋 標題候選數量: ${content.titleCandidates?.length || 0}`);
      
      // 顯示前 3 個標題候選
      if (content.titleCandidates && content.titleCandidates.length > 0) {
        console.log('\n   📋 標題候選範例:');
        content.titleCandidates.slice(0, 3).forEach((title, index) => {
          console.log(`      ${index + 1}. ${title}`);
        });
      }
    }
  } catch (error) {
    console.log(`   ❌ LLM 服務失敗: ${error.message}`);
    return;
  }

  // 測試結果
  console.log('\n🎉 快速測試完成！');
  console.log('\n📋 下一步測試建議:');
  console.log('   1. 執行完整上傳測試: npm start');
  console.log('   2. 開啟瀏覽器視窗觀察: export PLAYWRIGHT_HEADLESS=false');
  console.log('   3. 查看詳細測試指南: cat TEST_GUIDE.md');
}

// 執行測試
runQuickTest().catch(error => {
  console.error('\n💥 測試過程發生錯誤:', error);
  process.exit(1);
});