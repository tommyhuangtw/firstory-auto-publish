require('dotenv').config();
const { AirtableService } = require('./src/services/airtable');

async function testAirtableWithOpenRouter() {
  console.log('🧪 測試 Airtable + OpenRouter 整合...\n');
  
  try {
    const airtable = new AirtableService();
    
    console.log('📊 從 Airtable 獲取最新內容並生成標題...');
    const candidateData = await airtable.getLatestEpisodeContent();
    
    console.log('\n✅ 成功獲取資料：');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📅 記錄 ID: ${candidateData.recordId}`);
    console.log(`📅 日期: ${candidateData.date}`);
    console.log(`🏆 最佳標題: ${candidateData.title}`);
    console.log(`📊 最佳標題索引: ${candidateData.bestTitleIndex + 1}`);
    
    // 調試資訊
    console.log('\n🔍 調試資訊：');
    console.log('candidateData.titles:', candidateData.titles);
    console.log('candidateData.bestTitleIndex:', candidateData.bestTitleIndex);
    
    if (candidateData.titles && Array.isArray(candidateData.titles)) {
      console.log('\n🎯 所有候選標題：');
      candidateData.titles.forEach((title, index) => {
        const marker = index === candidateData.bestTitleIndex ? '🏆' : '  ';
        console.log(`${marker} ${index + 1}. ${title}`);
      });
    } else {
      console.log('\n⚠️ 沒有找到候選標題列表');
    }
    
    console.log('\n📝 生成的描述：');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(candidateData.description);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // 模擬添加集數編號
    const nextEpisodeNumber = 11;
    console.log(`\n🎬 模擬添加集數編號 EP${nextEpisodeNumber}：`);
    const titlesWithEpisodeNumber = candidateData.titles.map(title => 
      `EP${nextEpisodeNumber} - ${title}`
    );
    titlesWithEpisodeNumber.forEach((title, index) => {
      const marker = index === candidateData.bestTitleIndex ? '🏆' : '  ';
      console.log(`${marker} ${index + 1}. ${title}`);
    });
    
    console.log('\n🎉 測試成功！資料準備就緒，可以發送 Gmail。');
    
  } catch (error) {
    console.error('❌ 測試失敗:', error);
    if (error.stack) {
      console.error('錯誤堆疊:', error.stack);
    }
  }
}

// 執行測試
testAirtableWithOpenRouter();