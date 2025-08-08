require('dotenv').config();
const { OpenRouterService } = require('./src/services/openRouterService');

async function testOpenRouter() {
  console.log('🧪 開始測試 OpenRouter 服務...\n');
  
  const openRouter = new OpenRouterService();
  
  // 1. 測試基本連接
  console.log('📌 測試 1: 基本連接測試');
  console.log('------------------------');
  const connectionTest = await openRouter.testConnection();
  console.log('\n');
  
  // 2. 測試標題生成
  console.log('📌 測試 2: 生成 Podcast 標題');
  console.log('------------------------');
  const titlePrompt = `
請生成3個吸引人的 Podcast 標題，主題是關於最新的 AI 工具。
請以JSON格式回傳：
{
  "titles": [
    "標題1",
    "標題2",
    "標題3"
  ]
}
`;
  
  const titleResult = await openRouter.generateJSON(titlePrompt);
  if (titleResult.success && titleResult.data) {
    console.log('✅ 標題生成成功:');
    console.log(JSON.stringify(titleResult.data, null, 2));
    console.log(`📊 使用的模型: ${titleResult.model}`);
  } else {
    console.error('❌ 標題生成失敗:', titleResult.error);
  }
  console.log('\n');
  
  // 3. 測試模型切換（故意使用錯誤的主模型來觸發備用）
  console.log('📌 測試 3: 模型切換測試');
  console.log('------------------------');
  console.log('故意使用不存在的模型來測試備用機制...');
  
  const testService = new OpenRouterService();
  testService.models.primary = 'invalid/model-name'; // 設置無效的主模型
  
  const fallbackResult = await testService.generateContent('請說"Hello"', {
    maxTokens: 10,
    retryCount: 1 // 減少重試次數以加快測試
  });
  
  if (fallbackResult.success) {
    console.log('✅ 備用模型成功啟用');
    console.log(`📊 使用的模型: ${fallbackResult.model}`);
    console.log(`💬 回應: ${fallbackResult.content}`);
  } else {
    console.error('❌ 備用機制測試失敗:', fallbackResult.error);
  }
  console.log('\n');
  
  // 4. 測試完整的標題和描述生成流程
  console.log('📌 測試 4: 完整的標題和描述生成');
  console.log('------------------------');
  
  const fullPrompt = `
請根據以下內容生成 Podcast 資訊。

內容：今天介紹了5個最新的AI工具，包括ChatGPT的新功能、Claude的程式能力提升、Midjourney的圖像生成更新等。

請生成：
1. 一個吸引人的標題（20-30字）
2. 一個簡短的描述（50-100字）

以JSON格式回傳：
{
  "title": "標題",
  "description": "描述"
}
`;
  
  const fullResult = await openRouter.generateJSON(fullPrompt);
  if (fullResult.success && fullResult.data) {
    console.log('✅ 完整內容生成成功:');
    console.log(JSON.stringify(fullResult.data, null, 2));
    console.log(`📊 使用的模型: ${fullResult.model}`);
  } else {
    console.error('❌ 完整內容生成失敗:', fullResult.error);
  }
  
  console.log('\n🎉 測試完成！');
}

// 執行測試
testOpenRouter().catch(error => {
  console.error('💥 測試過程中發生錯誤:', error);
  process.exit(1);
});