const { runInteractiveSoundOnFlow } = require('./interactive-soundon-flow');

async function testInteractiveFlow() {
  console.log('🧪 開始測試互動式 SoundOn 流程...\n');
  
  try {
    const result = await runInteractiveSoundOnFlow();
    
    if (result.success) {
      console.log('\n✅ 測試成功！');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`📺 上傳標題: ${result.episodeTitle}`);
      console.log(`🔢 集數編號: EP${result.episodeNumber}`);
      console.log(`📊 選擇索引: ${result.selectedIndex}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    } else {
      console.log('\n❌ 測試失敗');
      console.log(`錯誤: ${result.error}`);
    }
    
  } catch (error) {
    console.error('\n💥 測試過程中發生錯誤:', error);
    process.exit(1);
  }
}

// 執行測試
if (require.main === module) {
  testInteractiveFlow();
}

module.exports = { testInteractiveFlow }; 