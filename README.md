# AI懶人報 Podcast 自動化系統

智能化 Podcast 上傳系統，支援 SoundOn 與 YouTube 平台，整合 Google Drive、Airtable、Gmail、OpenRouter AI 和 Web 控制台。

## 🚀 功能特色

- ✅ **AI 標題生成**: 透過 OpenRouter (Gemini) 生成 10 個多樣化的吸引人標題
- ✅ **互動式標題選擇**: 透過 Gmail 發送候選標題，用戶點擊選擇
- ✅ **自動集數檢測**: 智能分析現有單集，自動判斷下一集編號
- ✅ **超時機制**: 2分鐘內未選擇自動使用 AI 推薦的最佳標題
- ✅ **Google Drive 整合**: 自動下載最新音檔和封面圖片
- ✅ **Airtable 內容管理**: 從 Airtable 獲取單集內容和描述
- ✅ **完整 SoundOn 上傳**: 包含動態廣告設定和封面上傳
- ✅ **YouTube 自動發佈**: 自動生成縮圖、合成影片並上傳到 YouTube
- ✅ **手動上傳流程**: 無需 Airtable/Google Drive，直接指定音檔和文稿上傳
- ✅ **Web 控制台**: 瀏覽器介面操作上傳流程
- ✅ **AI 縮圖生成**: 透過 Kie.ai (Ideogram/Qwen) 生成 YouTube 縮圖
- ✅ **特別單元支援**: 支援「機器人觀察週報」和「AI懶人精選週報」等特別單元，自動切換標題/描述 Prompt
- ✅ **智能日誌**: 詳細的操作記錄和進度追蹤

## 🎯 快速開始

### 一鍵啟動 (推薦)
```bash
npm start
```

這將啟動完整的互動式自動化流程：
1. 🔍 自動檢測下一集編號
2. 🤖 AI 生成 10 個候選標題
3. 📧 發送選擇郵件到您的信箱
4. ⏰ 等待您選擇標題 (2分鐘超時)
5. 📥 下載 Google Drive 檔案
6. 🚀 自動上傳到 SoundOn
7. 📺 自動生成縮圖、合成影片並上傳到 YouTube

### 手動上傳模式

不依賴 Airtable/Google Drive，直接指定本地檔案：
```bash
node manual-upload-flow.js
```

### Web 控制台

透過瀏覽器介面操作：
```bash
cd web-console && node server.js
# 開啟 http://localhost:8888
```

### 特別單元模式

週四和週日有特別單元，使用 `--segment` 參數指定：

```bash
# 週四：機器人觀察週報
npm run start:robot
# 或
npm start -- --segment robot

# 週日：AI懶人精選週報
npm run start:weekly
# 或
npm start -- --segment weekly
```

特別單元會自動調整：
- **標題格式**: `EP256 ｜ 機器人觀察週報 - [標題]`（一般日為 `EP256 - [標題]`）
- **YouTube 標題**: `AI懶人報Podcast ｜ EP256 機器人觀察週報 - [標題]`
- **AI Prompt**: 根據單元類型切換標題和描述的生成 Prompt（例如機器人週報會聚焦機器人趨勢而非 AI 工具）

## 📋 環境要求

- Node.js 16+
- FFmpeg (用於音檔轉換和影片合成)
- Google Cloud Console 專案 (Google Drive + Gmail + YouTube Data API)
- Airtable 帳號和 API 金鑰
- OpenRouter API 金鑰 (Gemini AI)
- SoundOn 帳號
- YouTube 頻道 (需完成 OAuth 驗證)

## ⚙️ 安裝設定

### 1. 安裝依賴
```bash
npm install
```

### 2. 環境變數設定
複製 `.env.example` 為 `.env` 並填入所有必要設定：

```bash
# Google OAuth 設定
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret

# Gmail 設定
RECIPIENT_EMAIL=your_email@gmail.com

# Airtable 設定
AIRTABLE_API_KEY=your_airtable_api_key
AIRTABLE_BASE_ID=your_base_id
AIRTABLE_TABLE_NAME=your_table_name

# OpenRouter AI 設定
OPENROUTER_API_KEY=your_openrouter_api_key

# Playwright 設定
PLAYWRIGHT_HEADLESS=false
```

### 3. Google API 設定
1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 啟用 Google Drive API、Gmail API 和 YouTube Data API v3
3. 建立 OAuth 2.0 客戶端 ID
4. 在重新導向 URI 中添加: `http://localhost:3000/oauth2callback`
5. 下載 credentials.json 並放置在專案根目錄

## 🎮 使用方式

### 主要命令

```bash
# 🚀 啟動完整互動式流程 (預設)
npm start

# 🤖 週四：機器人觀察週報
npm run start:robot

# 📰 週日：AI懶人精選週報
npm run start:weekly

# 🔄 同上 (別名)
npm run interactive

# 📦 手動上傳流程
node manual-upload-flow.js

# 🌐 啟動 Web 控制台
cd web-console && node server.js

# 📺 測試 YouTube 上傳流程
npm run test-youtube

# 📧 重新授權 Gmail (如需要)
node reauth-gmail.js

# 🧪 測試 Google Drive 連接
npm run test-google-drive
```

### 其他可用命令

```bash
# 🔙 使用舊版流程 (無互動式選擇)
npm run legacy-flow

# 🔐 測試各種認證
npm run test-auth
npm run check-tokens

# 🎯 測試特定功能
npm run test-basic-upload
npm run test-studio
```

## 🔄 完整自動化流程

### 互動式 SoundOn 流程 (預設)

1. **🔧 服務初始化**
   - Google Drive 和 Gmail 認證
   - SoundOn 登入

2. **📊 智能集數檢測**
   - 分析現有單集列表
   - 解析 EP 編號
   - 自動判斷下一集編號

3. **🤖 AI 標題生成**
   - 從 Airtable 獲取最新內容
   - 透過 OpenRouter (Gemini) 生成 10 個多樣化標題
   - AI 分析並推薦最佳標題

4. **📧 互動式標題選擇**
   - 發送包含日期和集數的確認郵件
   - 用戶點擊郵件中的標題進行選擇
   - 2分鐘超時機制

5. **📥 檔案下載**
   - 從 Google Drive 下載最新音檔
   - 下載對應的封面圖片

6. **🚀 SoundOn 上傳**
   - 建立新單集
   - 上傳音檔和封面
   - 填寫標題和描述
   - 設定單集類型和動態廣告
   - 發布單集

7. **📺 YouTube 發佈**
   - 透過 Kie.ai 生成自訂縮圖
   - 合成影片 (音檔 + 封面圖 → MP4)
   - 上傳到 YouTube (含標題、描述、Tags、縮圖)

## 📁 專案結構

```
firstory-podcast-automation/
├── interactive-soundon-flow.js       # 🎯 主要互動式流程 (Airtable + Google Drive)
├── manual-upload-flow.js             # 📦 手動上傳流程 (本地檔案)
├── complete-soundon-flow.js          # 🔙 舊版流程
├── src/
│   ├── soundon-uploader.js           # SoundOn 上傳器
│   ├── services/
│   │   ├── googleDrive.js            # Google Drive 服務
│   │   ├── gmail.js                  # Gmail 服務
│   │   ├── airtable.js               # Airtable 服務
│   │   ├── contentGenerator.js       # AI 內容生成器 (標題/描述/Tags)
│   │   ├── openRouterService.js      # OpenRouter API 服務 (Gemini)
│   │   ├── kieAi.js                  # Kie.ai 圖片生成服務
│   │   ├── titleSelectionServer.js   # 標題選擇服務器
│   │   ├── youtube.js                # YouTube 上傳服務
│   │   ├── thumbnailGenerator.js     # 縮圖生成器
│   │   └── videoCreator.js           # 影片合成器 (音檔+圖片→MP4)
│   └── utils/
│       └── flowHelpers.js            # 共用工具 (音檔轉換/圖片壓縮/描述組裝)
├── web-console/
│   ├── server.js                     # Web 控制台伺服器 (port 8888)
│   └── public/index.html             # Web 介面
├── temp/                             # 暫存目錄
│   ├── downloads/                    # 檔案下載
│   └── browser-data/                 # 瀏覽器資料
└── credentials.json                  # Google OAuth 憑證
```

## 📊 資料結構要求

### Google Drive 資料夾
```
Google Drive/
├── Audio/          # 音檔 (.mp3)
└── Cover/          # 封面圖片 (.jpg, .png)
```

### Airtable 表格欄位
- `Email html`: Email HTML 內容 (用於 AI 生成)
- `Youtube Title1`: YouTube 標題
- `Raw Podcast Summary`: Podcast 內容摘要
- `Audio File ID`: Google Drive 音檔 ID
- `Cover Image ID`: Google Drive 封面圖 ID
- `Date`: 發布日期
- `Status`: 上傳狀態

## 🎨 AI 標題生成特色

- **多樣化風格**: 疑問句、感嘆句、陳述句等不同表達方式
- **吸引力優化**: 針對點擊率和分享潛力優化
- **SEO 友好**: 考慮搜尋引擎優化
- **時效性**: 具有新聞感和緊迫感
- **表情符號**: 適當使用流行網路用語和表情符號

## 🔧 故障排除

### 常見問題

1. **Gmail 權限不足**
   ```bash
   node reauth-gmail.js
   ```

2. **集數檢測失敗**
   - 檢查 SoundOn 登入狀態
   - 確認單集列表頁面可正常訪問

3. **AI 標題生成失敗**
   - 檢查 OpenRouter API 金鑰
   - 確認網路連線
   - 系統會自動使用備用標題

4. **檔案下載失敗**
   - 確認 Google Drive 資料夾結構
   - 檢查檔案權限

## 📈 版本歷史

- **v4.0**: 手動上傳流程 + Web 控制台 (目前版本)
  - 新增手動上傳流程 (`manual-upload-flow.js`)，無需 Airtable/Google Drive
  - Web 控制台介面，透過瀏覽器操作上傳
  - 重構內容生成為獨立 `ContentGenerator` 模組
  - 新增 OpenRouter 多模型支援 (Gemini + Claude fallback)
  - 新增 Kie.ai 圖片生成服務
  - 共用工具函數抽取至 `flowHelpers.js`
- **v3.0**: YouTube 自動發佈 + 特別單元支援
  - YouTube 影片自動合成與上傳（縮圖生成、影片合成）
  - `--segment` 參數支援週四「機器人觀察週報」、週日「AI懶人精選週報」
  - 各單元專屬標題/描述 AI Prompt
  - Description 課程推廣區塊（可切換）
- **v2.0**: 互動式 AI 標題選擇流程
- **v1.0**: 基礎自動化上傳流程

## 🤝 貢獻

歡迎提交 Issues 和 Pull Requests！

## 📄 授權

MIT License