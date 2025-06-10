const { SoundOnUploader } = require('./src/soundon-uploader');
const { GoogleDriveService } = require('./src/services/googleDrive');
const { AirtableService } = require('./src/services/airtable');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

async function completeSoundOnFlow() {
  const uploader = new SoundOnUploader();
  const googleDrive = new GoogleDriveService();
  const airtable = new AirtableService();
  
  try {
    console.log('🚀 開始完整的 SoundOn 自動化流程...\n');
    
    // 1. 初始化所有服務
    console.log('⚙️ 初始化服務...');
    await uploader.initialize();
    await googleDrive.initializeAuth();
    console.log('✅ 所有服務初始化完成\n');
    
    // 2. 從 Airtable 獲取最新內容並生成標題描述
    console.log('📊 從 Airtable 獲取內容並使用 Gemini AI 生成標題描述...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🤖 AI 生成流程：');
    console.log('   🎯 第一步：生成 10 個候選標題');
    console.log('   🏆 第二步：智能選擇最佳標題');
    console.log('   📝 第三步：生成 5 個工具的描述');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const episodeContent = await airtable.getLatestEpisodeContent();
    
    console.log('✅ AI 生成完成！結果預覽：');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📝 生成的標題: ${episodeContent.title}`);
    console.log(`📊 標題長度: ${episodeContent.title.length} 字元`);
    console.log(`📝 描述長度: ${episodeContent.description.length} 字元`);
    console.log(`🔢 包含工具數: ${(episodeContent.description.match(/💡/g) || []).length} 個`);
    console.log(`🎯 格式檢查: ${episodeContent.description.includes('🚀') && episodeContent.description.includes('💡') && episodeContent.description.includes('👉') ? '✅ 完美' : '⚠️ 需檢查'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // 3. 從 Google Drive 下載最新音檔
    console.log('🎵 從 Google Drive 下載最新音檔...');
    const audioResult = await googleDrive.downloadLatestAudioFile();
    console.log(`✅ 音檔下載完成: ${audioResult.originalName}`);
    console.log(`📁 音檔路徑: ${audioResult.path}\n`);
    
    // 4. 從 Google Drive 下載最新封面圖片
    console.log('🖼️ 從 Google Drive 下載最新封面圖片...');
    const coverResult = await googleDrive.downloadLatestCoverImage();
    console.log(`✅ 封面圖片下載完成: ${coverResult.originalName}`);
    console.log(`📁 封面圖片路徑: ${coverResult.path}\n`);
    
    // 5. 登入 SoundOn
    console.log('🔐 登入 SoundOn...');
    const loginSuccess = await uploader.login();
    if (!loginSuccess) {
      throw new Error('SoundOn 登入失敗');
    }
    console.log('✅ SoundOn 登入成功\n');
    
    // 6. 點擊新增單集
    console.log('➕ 點擊新增單集...');
    const newEpisodeSuccess = await uploader.clickNewEpisode();
    if (!newEpisodeSuccess) {
      throw new Error('無法點擊新增單集按鈕');
    }
    console.log('✅ 進入創建單集頁面\n');
    
    // 7. 上傳音檔
    console.log('🎵 上傳音檔...');
    const uploadSuccess = await uploader.uploadAudioFile(audioResult.path);
    if (!uploadSuccess) {
      throw new Error('音檔上傳失敗');
    }
    console.log('✅ 音檔上傳成功\n');
    
    // 8. 填寫單集資訊
    console.log('📝 填寫單集資訊...');
    const infoSuccess = await uploader.fillEpisodeInfo(
      episodeContent.title, 
      episodeContent.description
    );
    if (!infoSuccess) {
      console.log('⚠️ 填寫單集資訊失敗，但繼續流程');
    } else {
      console.log('✅ 單集資訊填寫完成');
    }
    
    // 9. 選擇上架類型：一般單集
    console.log('🔧 設定上架類型：一般單集...');
    const typeSuccess = await uploader.selectEpisodeType();
    if (!typeSuccess) {
      console.log('⚠️ 選擇上架類型失敗，但繼續流程');
    } else {
      console.log('✅ 已選擇一般單集');
    }
    
    // 10. 設定廣告選項：都選擇"否"
    console.log('📢 設定廣告選項：廣告置入和動態廣告置入都選"否"...');
    const adSuccess = await uploader.setAdvertisementOptions();
    if (!adSuccess) {
      console.log('⚠️ 設定廣告選項失敗，但繼續流程');
    } else {
      console.log('✅ 廣告選項設定完成');
    }
    
    // 11. 上傳封面圖片（在"更多"標籤中）
    console.log('🖼️ 上傳封面圖片...');
    const coverUploadSuccess = await uploader.uploadCoverImage(coverResult.path);
    if (!coverUploadSuccess) {
      console.log('⚠️ 封面圖片上傳失敗，但繼續流程');
    } else {
      console.log('✅ 封面圖片上傳成功');
    }
    
    // 12. 直接發布單集
    console.log('🎉 直接發布單集...');
    const publishSuccess = await uploader.publishEpisode();
    if (!publishSuccess) {
      throw new Error('發布單集失敗');
    }
    console.log('✅ 單集發布成功\n');
    
    // 13. 更新 Airtable 狀態
    console.log('📊 更新 Airtable 狀態...');
    try {
      await airtable.updateRecordStatus(episodeContent.recordId, 'SoundOn Published');
      console.log('✅ Airtable 狀態更新完成');
    } catch (error) {
      console.log('⚠️ Airtable 狀態更新失敗:', error.message);
    }
    
    console.log('\n🎉 SoundOn 自動化流程完全成功！');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 自動化摘要：');
    console.log(`📝 AI 生成標題: ${episodeContent.title}`);
    console.log(`📊 標題長度: ${episodeContent.title.length} 字元`);
    console.log(`🎵 音檔: ${audioResult.originalName}`);
    console.log(`🖼️ 封面: ${coverResult.originalName}`);
    console.log(`💾 狀態: 已發布`);
    console.log(`📝 描述長度: ${episodeContent.description.length} 字元`);
    console.log(`🔢 包含 AI 工具: ${(episodeContent.description.match(/💡/g) || []).length} 個`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🤖 AI 生成的描述預覽：');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // 顯示描述的前200字元
    const descriptionPreview = episodeContent.description.length > 200 
      ? episodeContent.description.substring(0, 200) + '...' 
      : episodeContent.description;
    console.log(descriptionPreview);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    return {
      success: true,
      title: episodeContent.title,
      description: episodeContent.description,
      descriptionLength: episodeContent.description.length,
      toolCount: (episodeContent.description.match(/💡/g) || []).length,
      audioFile: audioResult.originalName,
      coverImage: coverResult.originalName,
      recordId: episodeContent.recordId,
      aiGenerated: true,
      status: 'published'
    };
    
  } catch (error) {
    console.error('\n❌ SoundOn 自動化流程失敗:', error.message);
    
    // 嘗試保存錯誤截圖
    try {
      await uploader.page.screenshot({ path: 'temp/flow-error.png' });
      console.log('📸 錯誤截圖已保存到 temp/flow-error.png');
    } catch (screenshotError) {
      console.log('⚠️ 無法保存錯誤截圖');
    }
    
    return {
      success: false,
      error: error.message
    };
    
  } finally {
    // 清理臨時文件
    try {
      await googleDrive.cleanupTempFiles();
      console.log('🧹 臨時文件清理完成');
    } catch (cleanupError) {
      console.log('⚠️ 清理臨時文件失敗:', cleanupError.message);
    }
    
    // 保持瀏覽器打開以便檢查結果
    console.log('🔍 瀏覽器保持打開狀態，請手動檢查結果');
  }
}

// 如果直接執行這個文件
if (require.main === module) {
  completeSoundOnFlow()
    .then(result => {
      if (result.success) {
        console.log('\n✨ 流程執行完成 - 成功');
        process.exit(0);
      } else {
        console.log('\n💥 流程執行完成 - 失敗');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n💥 流程執行異常:', error.message);
      process.exit(1);
    });
}

module.exports = { completeSoundOnFlow }; 