const { google } = require('googleapis');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

class GoogleDriveAPIService {
  constructor() {
    this.tempDir = path.join(__dirname, '../../temp');
    this.pathsJsonFile = path.join(__dirname, '../../file-paths.json');
    this.credentialsFile = path.join(__dirname, '../../google-credentials.json');
    this.tokenFile = path.join(__dirname, '../../google-token.json');
    
    this.oauth2Client = null;
    this.drive = null;
    
    this.ensureTempDir();
  }

  async ensureTempDir() {
    await fs.ensureDir(this.tempDir);
  }

  // 初始化 Google Drive API 客戶端
  async initializeClient(clientId = null, clientSecret = null) {
    try {
      // 如果直接提供了認證資訊，使用它們
      if (clientId && clientSecret) {
        console.log('🔑 使用提供的 Client ID 和 Secret');
        
        this.oauth2Client = new google.auth.OAuth2(
          clientId,
          clientSecret,
          'urn:ietf:wg:oauth:2.0:oob' // 這是用於桌面應用的重定向 URI
        );
      } else {
        // 嘗試從環境變數或檔案讀取認證資訊
        const credentials = await this.loadCredentials();
        
        this.oauth2Client = new google.auth.OAuth2(
          credentials.client_id,
          credentials.client_secret,
          credentials.redirect_uris[0]
        );
      }

      // 檢查是否有儲存的 token
      if (await fs.pathExists(this.tokenFile)) {
        const token = await fs.readJson(this.tokenFile);
        this.oauth2Client.setCredentials(token);
        console.log('✅ 使用儲存的認證 token');
      } else {
        console.log('⚠️  需要進行 OAuth 認證');
        await this.authenticate();
      }

      // 初始化 Drive API
      this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
      
      console.log('🚀 Google Drive API 初始化完成');
      return true;
      
    } catch (error) {
      console.error('❌ Google Drive API 初始化失敗:', error.message);
      throw error;
    }
  }

  // 載入認證資訊
  async loadCredentials() {
    try {
      // 優先使用環境變數
      if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        return {
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uris: ['urn:ietf:wg:oauth:2.0:oob']
        };
      }
      
      // 其次使用檔案
      if (await fs.pathExists(this.credentialsFile)) {
        const credentials = await fs.readJson(this.credentialsFile);
        return credentials.installed || credentials.web;
      }
      
      throw new Error('找不到 Google 認證資訊');
    } catch (error) {
      throw new Error(`載入認證資訊失敗: ${error.message}`);
    }
  }

  // OAuth 認證流程
  async authenticate() {
    try {
      const authUrl = this.oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/drive.readonly']
      });

      console.log('\n🔗 請在瀏覽器中打開以下連結進行認證:');
      console.log(authUrl);
      console.log('\n📋 認證完成後，請複製授權碼並執行:');
      console.log(`node -e "require('./src/services/googleDriveAPI').setAuthCode('YOUR_AUTH_CODE')"`);
      
      throw new Error('需要完成 OAuth 認證流程');
    } catch (error) {
      throw error;
    }
  }

  // 設定授權碼
  async setAuthCode(code) {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      
      // 儲存 token
      await fs.writeJson(this.tokenFile, tokens);
      console.log('✅ 認證 token 已儲存');
      
      return tokens;
    } catch (error) {
      console.error('❌ 設定授權碼失敗:', error.message);
      throw error;
    }
  }

  // 獲取文件夾內容
  async listFilesInFolder(folderId, fileType = null) {
    try {
      console.log(`📁 獲取文件夾內容: ${folderId}`);
      
      let query = `'${folderId}' in parents and trashed=false`;
      
      // 根據檔案類型過濾
      if (fileType === 'audio') {
        query += ` and (mimeType contains 'audio' or name contains '.mp3' or name contains '.wav' or name contains '.m4a')`;
      } else if (fileType === 'image') {
        query += ` and (mimeType contains 'image' or name contains '.png' or name contains '.jpg' or name contains '.jpeg')`;
      }

      const response = await this.drive.files.list({
        q: query,
        fields: 'files(id,name,mimeType,size,modifiedTime,createdTime)',
        orderBy: 'modifiedTime desc',
        pageSize: 50
      });

      const files = response.data.files;
      console.log(`📋 找到 ${files.length} 個檔案`);
      
      return files;
    } catch (error) {
      console.error('❌ 獲取文件夾內容失敗:', error.message);
      throw error;
    }
  }

  // 下載檔案
  async downloadFile(fileId, fileName, localPath = null) {
    try {
      if (!localPath) {
        localPath = path.join(this.tempDir, fileName);
      }

      console.log(`⬇️ 下載檔案: ${fileName}`);
      
      const response = await this.drive.files.get({
        fileId: fileId,
        alt: 'media'
      }, {
        responseType: 'stream'
      });

      const writeStream = fs.createWriteStream(localPath);
      response.data.pipe(writeStream);

      return new Promise((resolve, reject) => {
        writeStream.on('finish', () => {
          console.log(`✅ 檔案下載完成: ${localPath}`);
          resolve({
            path: localPath,
            fileName: fileName,
            fileId: fileId
          });
        });
        
        writeStream.on('error', (error) => {
          console.error(`❌ 檔案下載失敗: ${error.message}`);
          reject(error);
        });
      });
      
    } catch (error) {
      console.error(`❌ 下載檔案失敗: ${error.message}`);
      throw error;
    }
  }

  // 從文件夾下載最新檔案
  async downloadLatestFileFromFolder(folderUrl, fileType = 'audio') {
    try {
      const folderId = this.extractFileIdFromUrl(folderUrl);
      console.log(`🎯 從文件夾下載最新 ${fileType} 檔案: ${folderId}`);
      
      // 獲取文件夾中的檔案
      const files = await this.listFilesInFolder(folderId, fileType);
      
      if (files.length === 0) {
        throw new Error(`文件夾中沒有找到 ${fileType} 檔案`);
      }

      // 選擇最新的檔案（已按修改時間降序排列）
      const latestFile = files[0];
      console.log(`📄 最新檔案: ${latestFile.name} (修改時間: ${latestFile.modifiedTime})`);
      
      // 下載檔案
      const result = await this.downloadFile(latestFile.id, latestFile.name);
      
      return {
        ...result,
        type: fileType,
        modifiedTime: latestFile.modifiedTime,
        size: latestFile.size
      };
      
    } catch (error) {
      console.error(`❌ 從文件夾下載最新檔案失敗: ${error.message}`);
      throw error;
    }
  }

  // 從 URL 提取檔案 ID
  extractFileIdFromUrl(shareUrl) {
    const patterns = [
      /\/file\/d\/([a-zA-Z0-9-_]+)/,
      /\/folders\/([a-zA-Z0-9-_]+)/,
      /id=([a-zA-Z0-9-_]+)/,
      /\/d\/([a-zA-Z0-9-_]+)/
    ];
    
    for (const pattern of patterns) {
      const match = shareUrl.match(pattern);
      if (match) {
        return match[1];
      }
    }
    
    throw new Error(`無法從連結中提取檔案 ID: ${shareUrl}`);
  }

  // 下載最新音檔和圖片並儲存路徑
  async downloadLatestFiles(audioFolderUrl, imageFolderUrl, clientId = null, clientSecret = null) {
    try {
      console.log('🚀 使用 Google Drive API 下載最新檔案...');
      
      // 初始化 API 客戶端
      await this.initializeClient(clientId, clientSecret);
      
      const results = {
        audio: null,
        image: null,
        timestamp: new Date().toISOString()
      };

      // 下載音檔
      if (audioFolderUrl) {
        console.log('\n🎵 下載最新音檔...');
        results.audio = await this.downloadLatestFileFromFolder(audioFolderUrl, 'audio');
      }

      // 下載圖片
      if (imageFolderUrl) {
        console.log('\n🖼️ 下載最新圖片...');
        results.image = await this.downloadLatestFileFromFolder(imageFolderUrl, 'image');
      }

      // 儲存路徑到 JSON
      await this.savePathsToJson(results);
      
      console.log('\n✅ 所有檔案下載完成！');
      return results;
      
    } catch (error) {
      console.error('❌ 下載失敗:', error.message);
      throw error;
    }
  }

  // 儲存路徑到 JSON
  async savePathsToJson(pathsData) {
    try {
      const jsonData = {
        lastUpdated: pathsData.timestamp,
        files: {
          audio: pathsData.audio ? {
            path: pathsData.audio.path,
            fileName: pathsData.audio.fileName,
            type: pathsData.audio.type,
            fileId: pathsData.audio.fileId,
            modifiedTime: pathsData.audio.modifiedTime,
            size: pathsData.audio.size
          } : null,
          image: pathsData.image ? {
            path: pathsData.image.path,
            fileName: pathsData.image.fileName,
            type: pathsData.image.type,
            fileId: pathsData.image.fileId,
            modifiedTime: pathsData.image.modifiedTime,
            size: pathsData.image.size
          } : null
        }
      };
      
      await fs.writeJson(this.pathsJsonFile, jsonData, { spaces: 2 });
      console.log(`💾 檔案路徑已儲存到: ${this.pathsJsonFile}`);
      
    } catch (error) {
      console.error('儲存路徑到 JSON 失敗:', error);
      throw error;
    }
  }
}

module.exports = { GoogleDriveAPIService }; 