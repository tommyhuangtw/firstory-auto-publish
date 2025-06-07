#!/usr/bin/env node
/**
 * Google Drive 連結設定指導
 * 
 * 由於 Google Drive 的限制，我們需要個別檔案的分享連結，而不是文件夾連結
 */

console.log('🔗 Google Drive 連結設定指導');
console.log('===============================\n');

console.log('📋 根據你提供的文件夾內容，我找到了最新的檔案：');
console.log('');

console.log('🎵 最新音檔：');
console.log('   檔案名稱: daily_podcast_chinese_2025-06-06.mp3');
console.log('   檔案大小: 16.1 MB');
console.log('   修改時間: 今天早上 5:24');
console.log('');

console.log('🖼️ 最新圖片：');
console.log('   檔案名稱: 8A2B8735-976E-48FC-AE86-A07FAAEE0ED7.png');
console.log('   檔案大小: 2.9 MB');
console.log('   修改時間: May 29, 2025');
console.log('');

console.log('❗ 重要：我們需要個別檔案的分享連結，而不是文件夾連結');
console.log('');

console.log('📝 請按照以下步驟設定：');
console.log('');

console.log('1️⃣ 音檔設定：');
console.log('   - 打開音檔文件夾：https://drive.google.com/drive/folders/1pB2PaU9BAKi0IGbIgudUEm29bgPhX1jq');
console.log('   - 找到檔案：daily_podcast_chinese_2025-06-06.mp3');
console.log('   - 右鍵點擊該檔案');
console.log('   - 選擇「取得連結」');
console.log('   - 設定為「知道連結的任何人」可檢視');
console.log('   - 複製連結（應該類似：https://drive.google.com/file/d/檔案ID/view）');
console.log('');

console.log('2️⃣ 圖片設定：');
console.log('   - 打開圖片文件夾：https://drive.google.com/drive/folders/1BCSiZXS8aGnMdOnfJfAbwgitFfliVbQ-');
console.log('   - 找到檔案：8A2B8735-976E-48FC-AE86-A07FAAEE0ED7.png');
console.log('   - 右鍵點擊該檔案');
console.log('   - 選擇「取得連結」');
console.log('   - 設定為「知道連結的任何人」可檢視');
console.log('   - 複製連結（應該類似：https://drive.google.com/file/d/檔案ID/view）');
console.log('');

console.log('3️⃣ 設定 .env 檔案：');
console.log('   在你的 .env 檔案中添加：');
console.log('   GOOGLE_DRIVE_AUDIO_URL=你的音檔直接連結');
console.log('   GOOGLE_DRIVE_COVER_URL=你的圖片直接連結');
console.log('');

console.log('🔍 連結格式範例：');
console.log('   正確：https://drive.google.com/file/d/1ABC123DEF456/view');
console.log('   錯誤：https://drive.google.com/drive/folders/1ABC123DEF456 (這是文件夾連結)');
console.log('');

console.log('✅ 設定完成後，執行以下指令測試：');
console.log('   npm run status');
console.log('   node test-simplified-drive.js');
console.log('');

console.log('🚀 然後就可以開始自動化上傳：');
console.log('   npm run test    # 測試模式');
console.log('   npm start       # 正式上傳');
console.log('');

console.log('💡 提示：');
console.log('   - 每次有新的音檔和圖片時，記得更新 .env 中的連結');
console.log('   - 確保連結設定為「知道連結的任何人」可檢視');
console.log('   - 檔案連結格式必須包含 /file/d/ 而不是 /folders/'); 