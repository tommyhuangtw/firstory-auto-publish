require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs-extra');
const path = require('path');

class GoogleDriveService {
  constructor() {
    this.drive = null;
    this.oauth2Client = null;
    // 指定的文件夾 ID
    this.COVER_FOLDER_ID = '1BCSiZXS8aGnMdOnfJfAbwgitFfliVbQ-'; // IG 圖片封面文件夾
    this.AUDIO_FOLDER_ID = '1pB2PaU9BAKi0IGbIgudUEm29bgPhX1jq'; // 音檔文件夾
    this.tokenPath = path.join(__dirname, '../../temp/google-tokens.json');
  }

  async initializeAuth() {
    try {
      // 使用 OAuth 2.0 認證
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      
      if (!clientId || !clientSecret) {
        throw new Error('請在 .env 檔案中設定 GOOGLE_CLIENT_ID 和 GOOGLE_CLIENT_SECRET');
      }

      // 創建 OAuth2 客戶端
      this.oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        'http://localhost:8080' // 使用 localhost:8080 作為重定向 URI
      );

      // 嘗試載入已保存的 token
      const hasValidToken = await this.loadSavedTokens();
      
      if (!hasValidToken) {
        console.log('🔑 需要進行 Google Drive 授權...');
        await this.getNewTokens();
      }

      // 設定 Google Drive API
      this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
      console.log('✅ Google Drive 認證成功');
      
    } catch (error) {
      console.error('❌ Google Drive 認證失敗:', error);
      throw error;
    }
  }

  async loadSavedTokens() {
    try {
      if (fs.existsSync(this.tokenPath)) {
        const tokens = await fs.readJSON(this.tokenPath);
        this.oauth2Client.setCredentials(tokens);
        
        // 檢查 token 是否仍然有效
        try {
          // 創建臨時的 drive 實例來測試 token
          const testDrive = google.drive({ version: 'v3', auth: this.oauth2Client });
          await testDrive.files.list({ pageSize: 1 });
          console.log('✅ 使用已保存的 Google Drive tokens');
          return true;
        } catch (error) {
          console.log('⚠️ 已保存的 tokens 已過期，需要重新授權');
          return false;
        }
      }
      return false;
    } catch (error) {
      console.log('⚠️ 載入 tokens 失敗，需要重新授權');
      return false;
    }
  }

  async getNewTokens() {
    // 產生授權 URL
    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.file'
      ],
      prompt: 'consent'
    });

    console.log('\n🔗 請在瀏覽器中開啟以下 URL 進行授權:');
    console.log(authUrl);
    console.log('\n⚡ 授權完成後，瀏覽器將會自動重定向到 localhost，請稍候...');

    // 創建臨時 HTTP 服務器接收授權碼
    const authCode = await this.startAuthServer();
    
    try {
      // 使用授權碼獲取 tokens
      const { tokens } = await this.oauth2Client.getToken(authCode);
      this.oauth2Client.setCredentials(tokens);
      
      // 保存 tokens
      await this.saveTokens(tokens);
      console.log('✅ Google Drive 授權完成並已保存');
      
    } catch (error) {
      throw new Error(`授權失敗: ${error.message}`);
    }
  }

  async startAuthServer() {
    return new Promise((resolve, reject) => {
      const http = require('http');
      const url = require('url');
      
      const server = http.createServer((req, res) => {
        const query = url.parse(req.url, true).query;
        
        if (query.code) {
          // 成功獲取授權碼
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <html>
              <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h2>✅ 授權成功！</h2>
                <p>您可以關閉這個頁面，返回終端機繼續操作。</p>
                <script>setTimeout(() => window.close(), 2000);</script>
              </body>
            </html>
          `);
          
          server.close();
          resolve(query.code);
          
        } else if (query.error) {
          // 授權失敗
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <html>
              <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h2>❌ 授權失敗</h2>
                <p>錯誤: ${query.error}</p>
                <p>請關閉這個頁面並重試。</p>
              </body>
            </html>
          `);
          
          server.close();
          reject(new Error(query.error));
        }
      });
      
      server.listen(8080, () => {
        console.log('🌐 臨時授權服務器已啟動在 http://localhost:8080');
      });
      
      // 設置超時
      setTimeout(() => {
        server.close();
        reject(new Error('授權超時，請重試'));
      }, 300000); // 5分鐘超時
    });
  }

  async saveTokens(tokens) {
    try {
      const tempDir = path.dirname(this.tokenPath);
      await fs.ensureDir(tempDir);
      await fs.writeJSON(this.tokenPath, tokens, { spaces: 2 });
    } catch (error) {
      console.error('保存 tokens 失敗:', error);
    }
  }

  async getLatestFileFromFolder(folderId, fileTypes = []) {
    try {
      console.log(`🔍 搜尋文件夾中的最新檔案: ${folderId}`);
      
      // 先嘗試獲取所有檔案來除錯
      console.log('🔍 查詢所有檔案...');
      let allFilesQuery = `'${folderId}' in parents and trashed = false`;
      
      const allFilesResponse = await this.drive.files.list({
        q: allFilesQuery,
        orderBy: 'modifiedTime desc',
        fields: 'files(id, name, mimeType, modifiedTime, size)',
        pageSize: 20
      });

      const allFiles = allFilesResponse.data.files;
      console.log(`📊 文件夾中共有 ${allFiles ? allFiles.length : 0} 個檔案`);
      
      if (allFiles && allFiles.length > 0) {
        console.log('📁 前幾個檔案:');
        allFiles.slice(0, 5).forEach((file, index) => {
          console.log(`   ${index + 1}. ${file.name} (${file.mimeType}) - ${file.modifiedTime}`);
        });
      }

      if (!allFiles || allFiles.length === 0) {
        throw new Error(`文件夾 ${folderId} 中沒有找到任何檔案，請檢查文件夾 ID 和權限設定`);
      }

      // 如果指定了檔案類型，進行過濾
      let filteredFiles = allFiles;
      if (fileTypes.length > 0) {
        filteredFiles = allFiles.filter(file => 
          fileTypes.some(type => file.mimeType && file.mimeType.includes(type))
        );
        
        console.log(`🔍 篩選後符合類型 [${fileTypes.join(', ')}] 的檔案: ${filteredFiles.length} 個`);
        
        if (filteredFiles.length === 0) {
          console.log('⚠️ 沒有找到符合類型的檔案，返回最新檔案');
          filteredFiles = allFiles;
        }
      }

      const latestFile = filteredFiles[0];
      console.log(`✅ 選擇檔案: ${latestFile.name} (${latestFile.mimeType})`);
      
      return latestFile;
    } catch (error) {
      console.error('獲取最新檔案失敗:', error);
      throw error;
    }
  }

  async downloadFile(fileId, fileName) {
    try {
      const tempDir = path.join(__dirname, '../../temp');
      await fs.ensureDir(tempDir);

      const filePath = path.join(tempDir, fileName);
      
      console.log(`⬇️ 開始下載檔案: ${fileName}`);
      
      // 下載檔案
      const response = await this.drive.files.get({
        fileId: fileId,
        alt: 'media'
      }, { responseType: 'stream' });

      const writeStream = fs.createWriteStream(filePath);
      response.data.pipe(writeStream);

      return new Promise((resolve, reject) => {
        writeStream.on('finish', () => {
          console.log(`✅ 檔案下載完成: ${filePath}`);
          resolve(filePath);
        });
        writeStream.on('error', (error) => {
          console.error(`❌ 檔案下載失敗: ${error}`);
          reject(error);
        });
      });
    } catch (error) {
      console.error('下載檔案失敗:', error);
      throw error;
    }
  }

  async downloadLatestAudioFile() {
    try {
      console.log('🎵 獲取最新音檔...');
      
      // 從音檔文件夾獲取最新音檔
      const latestAudio = await this.getLatestFileFromFolder(
        this.AUDIO_FOLDER_ID, 
        ['audio'] // 只搜尋音檔
      );

      // 下載檔案
      const filePath = await this.downloadFile(latestAudio.id, latestAudio.name);
      
      return {
        path: filePath,
        originalName: latestAudio.name,
        fileId: latestAudio.id
      };
    } catch (error) {
      console.error('下載音檔失敗:', error);
      throw error;
    }
  }

  async downloadLatestCoverImage() {
    try {
      console.log('🖼️ 獲取最新封面圖片...');
      
      // 從封面文件夾獲取最新圖片
      const latestImage = await this.getLatestFileFromFolder(
        this.COVER_FOLDER_ID, 
        ['image'] // 只搜尋圖片檔
      );

      // 下載檔案
      const filePath = await this.downloadFile(latestImage.id, latestImage.name);
      
      return {
        path: filePath,
        originalName: latestImage.name,
        fileId: latestImage.id
      };
    } catch (error) {
      console.error('下載封面圖片失敗:', error);
      throw error;
    }
  }

  // 保留舊的函數以維持向後兼容性
  async downloadAudioFile(fileId) {
    if (!fileId) {
      // 如果沒有提供 fileId，使用新的方法獲取最新音檔
      const result = await this.downloadLatestAudioFile();
      return result.path;
    }
    
    // 原有的下載邏輯（使用特定 fileId）
    try {
      const fileInfo = await this.drive.files.get({
        fileId: fileId,
        fields: 'name'
      });
      
      const filePath = await this.downloadFile(fileId, fileInfo.data.name);
      return filePath;
    } catch (error) {
      console.error('下載音檔失敗:', error);
      throw error;
    }
  }

  async downloadCoverImage(fileId) {
    if (!fileId) {
      // 如果沒有提供 fileId，使用新的方法獲取最新封面
      const result = await this.downloadLatestCoverImage();
      return result.path;
    }
    
    // 原有的下載邏輯（使用特定 fileId）
    try {
      const fileInfo = await this.drive.files.get({
        fileId: fileId,
        fields: 'name'
      });
      
      const filePath = await this.downloadFile(fileId, fileInfo.data.name);
      return filePath;
    } catch (error) {
      console.error('下載封面失敗:', error);
      throw error;
    }
  }

  async cleanupTempFiles() {
    try {
      const tempDir = path.join(__dirname, '../../temp');
      await fs.emptyDir(tempDir);
    } catch (error) {
      console.error('清理暫存檔案失敗:', error);
    }
  }
}

module.exports = { GoogleDriveService };