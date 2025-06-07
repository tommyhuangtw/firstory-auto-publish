#!/usr/bin/env node
/**
 * 進階 Google Drive 文件夾下載器
 * 
 * 使用多種方法嘗試從 Google Drive 文件夾獲取和下載最新檔案
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { GoogleDriveService } = require('./src/services/googleDrive');

class AdvancedDriveDownloader extends GoogleDriveService {
  
  // 嘗試從文件夾頁面解析檔案 ID
  async parseFileIdsFromFolderPage(folderUrl) {
    try {
      console.log(`🔍 嘗試解析文件夾頁面: ${folderUrl}`);
      
      const response = await axios.get(folderUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      });
      
      const html = response.data;
      
      // 嘗試從頁面中提取檔案 ID 和名稱
      const fileMatches = html.match(/"(1[a-zA-Z0-9_-]{25,})".*?"([^"]*\.(?:mp3|png|jpg|jpeg))"/gi);
      
      if (fileMatches) {
        const files = fileMatches.map(match => {
          const idMatch = match.match(/"(1[a-zA-Z0-9_-]{25,})"/);
          const nameMatch = match.match(/"([^"]*\.(?:mp3|png|jpg|jpeg))"/);
          
          return {
            id: idMatch ? idMatch[1] : null,
            name: nameMatch ? nameMatch[1] : null
          };
        }).filter(f => f.id && f.name);
        
        console.log(`📁 找到 ${files.length} 個檔案:`, files);
        return files;
      }
      
      return [];
    } catch (error) {
      console.error('解析文件夾頁面失敗:', error.message);
      return [];
    }
  }
  
  // 嘗試使用 Google Drive API 的公開端點
  async tryPublicApiApproach(folderId) {
    try {
      console.log(`🌐 嘗試公開 API 端點: ${folderId}`);
      
      // 嘗試使用公開的 Google Drive API v3 端點
      const apiUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,name,mimeType,modifiedTime)&orderBy=modifiedTime desc`;
      
      const response = await axios.get(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      });
      
      if (response.data && response.data.files) {
        console.log(`📁 API 返回 ${response.data.files.length} 個檔案`);
        return response.data.files;
      }
      
      return [];
    } catch (error) {
      console.log('公開 API 方法失敗:', error.message);
      return [];
    }
  }
  
  // 智能下載最新檔案
  async smartDownloadFromFolder(folderUrl, fileType = 'all') {
    console.log(`🧠 智能下載模式: ${folderUrl}`);
    
    const folderId = this.extractFileIdFromUrl(folderUrl);
    let files = [];
    
    // 方法 1: 嘗試公開 API
    files = await this.tryPublicApiApproach(folderId);
    
    // 方法 2: 嘗試解析頁面內容
    if (files.length === 0) {
      files = await this.parseFileIdsFromFolderPage(folderUrl);
    }
    
    // 方法 3: 使用已知的檔案信息（回退方案）
    if (files.length === 0) {
      console.log('⚠️  無法自動獲取檔案，使用已知檔案信息');
      
      if (folderId === '1pB2PaU9BAKi0IGbIgudUEm29bgPhX1jq') {
        // 音檔文件夾
        return {
          fileName: 'daily_podcast_chinese_2025-06-06.mp3',
          type: 'audio',
          needsManualLink: true,
          suggestedAction: '請提供此檔案的直接分享連結'
        };
      } else if (folderId === '1BCSiZXS8aGnMdOnfJfAbwgitFfliVbQ-') {
        // 圖片文件夾
        return {
          fileName: '8A2B8735-976E-48FC-AE86-A07FAAEE0ED7.png',
          type: 'image',
          needsManualLink: true,
          suggestedAction: '請提供此檔案的直接分享連結'
        };
      }
    }
    
    // 如果找到檔案，嘗試下載最新的
    if (files.length > 0) {
      console.log(`✅ 找到 ${files.length} 個檔案，正在選擇最新的...`);
      
      // 根據檔案類型過濾
      let targetFiles = files;
      if (fileType === 'audio') {
        targetFiles = files.filter(f => f.name && f.name.match(/\.(mp3|wav|m4a)$/i));
      } else if (fileType === 'image') {
        targetFiles = files.filter(f => f.name && f.name.match(/\.(png|jpg|jpeg|gif)$/i));
      }
      
      if (targetFiles.length > 0) {
        // 選擇最新的檔案（假設按修改時間排序）
        const latestFile = targetFiles[0];
        console.log(`🎯 選擇檔案: ${latestFile.name}`);
        
        try {
          // 嘗試下載
          const downloadUrl = this.generateDirectDownloadUrl(latestFile.id);
          const localPath = path.join(this.tempDir, latestFile.name);
          
          await this.downloadFromUrl(downloadUrl, localPath);
          
          return {
            fileName: latestFile.name,
            path: localPath,
            type: fileType,
            fileId: latestFile.id,
            downloaded: true
          };
        } catch (downloadError) {
          console.error(`下載失敗: ${downloadError.message}`);
          return {
            fileName: latestFile.name,
            type: fileType,
            fileId: latestFile.id,
            needsManualLink: true,
            error: downloadError.message
          };
        }
      }
    }
    
    return null;
  }
  
  // 直接從 URL 下載檔案
  async downloadFromUrl(url, filePath) {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    const writeStream = fs.createWriteStream(filePath);
    response.data.pipe(writeStream);

    return new Promise((resolve, reject) => {
      writeStream.on('finish', () => {
        console.log(`✅ 檔案下載完成: ${filePath}`);
        resolve(filePath);
      });
      
      writeStream.on('error', (error) => {
        console.error(`❌ 檔案下載失敗: ${error.message}`);
        reject(error);
      });
    });
  }
}

// 主要執行函數
async function advancedDownload() {
  console.log('🚀 啟動進階 Google Drive 下載器...');
  console.log('=====================================\n');
  
  const downloader = new AdvancedDriveDownloader();
  
  const AUDIO_FOLDER_URL = 'https://drive.google.com/drive/folders/1pB2PaU9BAKi0IGbIgudUEm29bgPhX1jq?usp=sharing';
  const IMAGE_FOLDER_URL = 'https://drive.google.com/drive/folders/1BCSiZXS8aGnMdOnfJfAbwgitFfliVbQ-?usp=drive_link';
  
  const results = {
    audio: null,
    image: null,
    timestamp: new Date().toISOString()
  };
  
  try {
    // 下載音檔
    console.log('🎵 嘗試智能下載音檔...');
    results.audio = await downloader.smartDownloadFromFolder(AUDIO_FOLDER_URL, 'audio');
    
    // 下載圖片
    console.log('\n🖼️ 嘗試智能下載圖片...');
    results.image = await downloader.smartDownloadFromFolder(IMAGE_FOLDER_URL, 'image');
    
    // 儲存結果
    await downloader.savePathsToJson(results);
    
    console.log('\n📊 下載結果總結:');
    console.log('================');
    
    if (results.audio) {
      console.log(`🎵 音檔: ${results.audio.fileName}`);
      if (results.audio.downloaded) {
        console.log(`   ✅ 已下載到: ${results.audio.path}`);
      } else {
        console.log(`   ⚠️  ${results.audio.suggestedAction || '需要手動處理'}`);
      }
    }
    
    if (results.image) {
      console.log(`🖼️ 圖片: ${results.image.fileName}`);
      if (results.image.downloaded) {
        console.log(`   ✅ 已下載到: ${results.image.path}`);
      } else {
        console.log(`   ⚠️  ${results.image.suggestedAction || '需要手動處理'}`);
      }
    }
    
    console.log('\n💡 後續步驟:');
    if (results.audio?.downloaded && results.image?.downloaded) {
      console.log('   🚀 所有檔案已下載，可以執行: npm start');
    } else {
      console.log('   📝 請提供個別檔案的分享連結來完成下載');
      console.log('   🔧 執行: npm run setup-guide 來獲取詳細指導');
    }
    
  } catch (error) {
    console.error('\n💥 進階下載失敗:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  advancedDownload();
}

module.exports = { AdvancedDriveDownloader }; 