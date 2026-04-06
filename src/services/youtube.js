require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs-extra');
const path = require('path');

class YouTubeService {
  constructor() {
    this.youtube = null;
    this.oauth2Client = null;
    this.tokenPath = path.join(__dirname, '../../temp/youtube-tokens.json');
  }

  async initializeAuth() {
    try {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error('請在 .env 檔案中設定 GOOGLE_CLIENT_ID 和 GOOGLE_CLIENT_SECRET');
      }

      this.oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        'http://localhost:8080'
      );

      // 自動刷新 token
      this.oauth2Client.on('tokens', (tokens) => {
        console.log('🔄 [YouTube] 收到新的 tokens，正在保存...');
        this.saveTokens(tokens);
      });

      const hasValidToken = await this.loadSavedTokens();

      if (!hasValidToken) {
        console.log('🔑 [YouTube] 需要進行 YouTube 授權...');
        await this.getNewTokens();
      }

      this.youtube = google.youtube({ version: 'v3', auth: this.oauth2Client });
      console.log('✅ [YouTube] 認證成功');
    } catch (error) {
      console.error('❌ [YouTube] 認證失敗:', error);
      throw error;
    }
  }

  /**
   * 共享 Google Drive 的 OAuth client（避免重複授權）
   * 需要確保 Drive 的 token 包含 YouTube scopes
   */
  async initializeWithSharedAuth(oauth2Client) {
    try {
      this.oauth2Client = oauth2Client;
      this.youtube = google.youtube({ version: 'v3', auth: this.oauth2Client });

      // 測試 YouTube API 存取
      await this.youtube.channels.list({
        part: 'snippet',
        mine: true
      });

      console.log('✅ [YouTube] 使用共享認證成功');
    } catch (error) {
      console.log('⚠️ [YouTube] 共享認證無 YouTube 權限，需要獨立授權...');
      await this.initializeAuth();
    }
  }

  async loadSavedTokens() {
    try {
      if (fs.existsSync(this.tokenPath)) {
        const tokens = await fs.readJSON(this.tokenPath);
        this.oauth2Client.setCredentials(tokens);

        try {
          const testYoutube = google.youtube({ version: 'v3', auth: this.oauth2Client });
          await testYoutube.channels.list({ part: 'snippet', mine: true });
          console.log('✅ [YouTube] 使用已保存的 tokens');
          return true;
        } catch (error) {
          if (tokens.refresh_token) {
            try {
              const { credentials } = await this.oauth2Client.refreshAccessToken();
              credentials.refresh_token = tokens.refresh_token;
              this.oauth2Client.setCredentials(credentials);
              await this.saveTokens(credentials);
              console.log('✅ [YouTube] 成功刷新 tokens');
              return true;
            } catch (refreshError) {
              console.log('❌ [YouTube] 刷新 tokens 失敗:', refreshError.message);
              return false;
            }
          }
          return false;
        }
      }
      return false;
    } catch (error) {
      console.log('⚠️ [YouTube] 載入 tokens 失敗:', error.message);
      return false;
    }
  }

  async getNewTokens() {
    const availablePort = await this._findAvailablePort(8090);
    const redirectUri = `http://localhost:${availablePort}`;

    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );

    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube',
        'https://www.googleapis.com/auth/youtube.force-ssl'
      ],
      prompt: 'consent'
    });

    console.log('\n🔗 [YouTube] 請在瀏覽器中開啟以下 URL 進行授權:');
    console.log(authUrl);
    console.log(`\n⚡ 授權完成後，瀏覽器將會自動重定向到 localhost:${availablePort}`);

    const authCode = await this._startAuthServer(availablePort);

    const { tokens } = await this.oauth2Client.getToken(authCode);
    this.oauth2Client.setCredentials(tokens);
    await this.saveTokens(tokens);
    console.log('✅ [YouTube] 授權完成並已保存');
  }

  async saveTokens(tokens) {
    try {
      await fs.ensureDir(path.dirname(this.tokenPath));
      const tokensToSave = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        token_type: tokens.token_type,
        expiry_date: tokens.expiry_date
      };
      await fs.writeJSON(this.tokenPath, tokensToSave, { spaces: 2 });
      console.log(`💾 [YouTube] tokens 已保存到: ${this.tokenPath}`);
    } catch (error) {
      console.error('[YouTube] 保存 tokens 失敗:', error);
    }
  }

  /**
   * 上傳影片到 YouTube
   * @param {Object} options
   * @param {string} options.videoPath - 影片檔案路徑 (.mp4)
   * @param {string} options.title - 影片標題
   * @param {string} options.description - 影片描述
   * @param {string[]} [options.tags] - 標籤
   * @param {string} [options.privacyStatus] - 'public', 'private', 或 'unlisted'
   * @param {string} [options.categoryId] - YouTube 分類 ID（22 = People & Blogs）
   * @param {string} [options.thumbnailPath] - 自訂縮圖路徑
   * @returns {Object} 上傳結果 { videoId, videoUrl }
   */
  async uploadVideo(options) {
    const {
      videoPath,
      title,
      description,
      tags = ['AI', 'podcast', '懶人報', 'AI工具', '人工智慧'],
      privacyStatus = 'public',
      categoryId = '22',
      thumbnailPath = null
    } = options;

    console.log('🚀 [YouTube] 開始上傳影片...');
    console.log(`   標題: ${title}`);
    console.log(`   隱私: ${privacyStatus}`);

    if (!await fs.pathExists(videoPath)) {
      throw new Error(`影片檔案不存在: ${videoPath}`);
    }

    const fileSize = (await fs.stat(videoPath)).size;
    console.log(`   檔案大小: ${(fileSize / (1024 * 1024)).toFixed(1)} MB`);

    // 上傳影片
    const response = await this.youtube.videos.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title,
          description,
          tags,
          categoryId,
          defaultLanguage: 'zh-TW',
          defaultAudioLanguage: 'zh-TW'
        },
        status: {
          privacyStatus,
          selfDeclaredMadeForKids: false,
          embeddable: true
        }
      },
      media: {
        body: fs.createReadStream(videoPath)
      }
    }, {
      // 啟用 resumable upload 的進度回報
      onUploadProgress: (evt) => {
        const progress = ((evt.bytesRead / fileSize) * 100).toFixed(1);
        process.stdout.write(`\r   上傳進度: ${progress}%`);
      }
    });

    const videoId = response.data.id;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`\n✅ [YouTube] 影片上傳成功！`);
    console.log(`   Video ID: ${videoId}`);
    console.log(`   URL: ${videoUrl}`);

    // 上傳自訂縮圖
    if (thumbnailPath && await fs.pathExists(thumbnailPath)) {
      await this.setThumbnail(videoId, thumbnailPath);
    }

    return { videoId, videoUrl };
  }

  /**
   * 設定影片的自訂縮圖
   */
  async setThumbnail(videoId, thumbnailPath) {
    try {
      console.log('🖼️ [YouTube] 上傳自訂縮圖...');

      // 檢查檔案大小（需要 < 2MB）
      const stats = await fs.stat(thumbnailPath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`   縮圖大小: ${sizeMB} MB`);
      if (stats.size > 2 * 1024 * 1024) {
        console.log('⚠️ [YouTube] 縮圖檔案超過 2MB，跳過上傳');
        return;
      }

      const ext = path.extname(thumbnailPath).toLowerCase();
      const mimeType = (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'image/png';

      await this.youtube.thumbnails.set({
        videoId,
        media: {
          mimeType,
          body: fs.createReadStream(thumbnailPath)
        }
      });

      console.log('✅ [YouTube] 自訂縮圖設定成功');
    } catch (error) {
      console.error('⚠️ [YouTube] 縮圖上傳失敗（頻道可能需要電話驗證）:', error.message);
    }
  }

  /**
   * 取得頻道資訊
   */
  async getChannelInfo() {
    const response = await this.youtube.channels.list({
      part: 'snippet,statistics',
      mine: true
    });

    if (response.data.items && response.data.items.length > 0) {
      const channel = response.data.items[0];
      return {
        id: channel.id,
        title: channel.snippet.title,
        subscriberCount: channel.statistics.subscriberCount,
        videoCount: channel.statistics.videoCount
      };
    }
    return null;
  }

  async _findAvailablePort(startPort) {
    const net = require('net');
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(startPort, () => {
        const { port } = server.address();
        server.close(() => resolve(port));
      });
      server.on('error', () => resolve(this._findAvailablePort(startPort + 1)));
    });
  }

  async _startAuthServer(port) {
    return new Promise((resolve, reject) => {
      const http = require('http');
      const url = require('url');

      const server = http.createServer((req, res) => {
        const query = url.parse(req.url, true).query;
        if (query.code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<html><body style="font-family:Arial;text-align:center;padding:50px;">
            <h2>✅ YouTube 授權成功！</h2>
            <p>您可以關閉這個頁面。</p>
            <script>setTimeout(()=>window.close(),2000);</script>
          </body></html>`);
          server.close();
          resolve(query.code);
        } else if (query.error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<html><body><h2>❌ 授權失敗: ${query.error}</h2></body></html>`);
          server.close();
          reject(new Error(query.error));
        }
      });

      server.listen(port, () => {
        console.log(`🌐 [YouTube] 授權服務器已啟動在 http://localhost:${port}`);
      });

      setTimeout(() => {
        server.close();
        reject(new Error('YouTube 授權超時'));
      }, 300000);
    });
  }
}

module.exports = { YouTubeService };
