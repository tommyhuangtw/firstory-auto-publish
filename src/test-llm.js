const { LLMService } = require('./services/llm');
const { AirtableService } = require('./services/airtable');

require('dotenv').config();

async function testLLM() {
  try {
    console.log('🧠 測試 Gemini LLM 服務...');
    
    const airtable = new AirtableService();
    const llm = new LLMService();
    
    // 獲取最新的 episode 資料
    console.log('📊 從 Airtable 獲取資料...');
    const episodeData = await airtable.getNextEpisodeToUpload();
    
    if (!episodeData) {
      console.log('❌ 沒有找到 episode 資料');
      return;
    }
    
    console.log('✅ 找到 episode:', episodeData.title);
    console.log('📧 Email HTML 內容長度:', episodeData.emailHtml?.length || 0);
    
    // 生成標題和描述
    console.log('\n🚀 開始生成內容...');
    const content = await llm.generateEpisodeContent(episodeData);
    
    console.log('\n📝 生成結果:');
    console.log('='.repeat(50));
    console.log('🏆 最佳標題:', content.title);
    console.log('\n📋 所有標題候選:');
    content.titleCandidates?.forEach((title, index) => {
      console.log(`${index + 1}. ${title}`);
    });
    
    console.log('\n📖 描述內容:');
    console.log(content.description);
    console.log('='.repeat(50));
    
  } catch (error) {
    console.error('❌ 測試失敗:', error);
  }
}

testLLM();