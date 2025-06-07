const { PodcastAutomation } = require('./main');

async function testUpload() {
  console.log('開始測試 Podcast 自動上傳系統...');
  
  const automation = new PodcastAutomation();
  
  try {
    await automation.processNextEpisode();
    console.log('測試完成！');
  } catch (error) {
    console.error('測試失敗:', error);
  }
}

testUpload();