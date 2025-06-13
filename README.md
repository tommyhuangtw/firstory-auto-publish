# AI懶人報 Podcast 自動化系統

智能化 Podcast 上傳系統，支援 SoundOn 平台，整合 Google Drive、Airtable、Gmail 和 AI 標題生成。

## 🚀 功能特色

- ✅ **AI 標題生成**: 使用 Gemini AI 生成 10 個多樣化的吸引人標題
- ✅ **互動式標題選擇**: 透過 Gmail 發送候選標題，用戶點擊選擇
- ✅ **自動集數檢測**: 智能分析現有單集，自動判斷下一集編號
- ✅ **超時機制**: 2分鐘內未選擇自動使用 AI 推薦的最佳標題
- ✅ **Google Drive 整合**: 自動下載最新音檔和封面圖片
- ✅ **Airtable 內容管理**: 從 Airtable 獲取單集內容和描述
- ✅ **完整 SoundOn 上傳**: 包含動態廣告設定和封面上傳
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

## 📋 環境要求

- Node.js 16+
- Google Cloud Console 專案 (Google Drive + Gmail API)
- Airtable 帳號和 API 金鑰
- Gemini AI API 金鑰
- SoundOn 帳號

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

# Gemini AI 設定
GEMINI_API_KEY=your_gemini_api_key

# Playwright 設定
PLAYWRIGHT_HEADLESS=false
```

### 3. Google API 設定
1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 啟用 Google Drive API 和 Gmail API
3. 建立 OAuth 2.0 客戶端 ID
4. 在重新導向 URI 中添加: `http://localhost:3000/oauth2callback`
5. 下載 credentials.json 並放置在專案根目錄

## 🎮 使用方式

### 主要命令

```bash
# 🚀 啟動完整互動式流程 (預設)
npm start

# 🔄 同上 (別名)
npm run interactive

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
   - Gemini AI 生成 10 個多樣化標題
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

## 📁 專案結構

```
firstory-podcast-automation/
├── interactive-soundon-flow.js    # 🎯 主要互動式流程
├── src/
│   ├── soundon-uploader.js        # SoundOn 上傳器
│   └── services/
│       ├── googleDrive.js         # Google Drive 服務
│       ├── gmail.js               # Gmail 服務
│       ├── airtable.js            # Airtable 服務
│       └── titleSelectionServer.js # 標題選擇服務器
├── temp/                          # 暫存目錄
│   ├── downloads/                 # 檔案下載
│   └── browser-data/              # 瀏覽器資料
└── credentials.json               # Google OAuth 憑證
```

## 📊 資料結構要求

### Google Drive 資料夾
```
Google Drive/
├── Audio/          # 音檔 (.mp3)
└── Cover/          # 封面圖片 (.jpg, .png)
```

### Airtable 表格欄位
- `title`: 單集標題
- `description`: 單集描述
- `date`: 發布日期

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
   - 檢查 Gemini API 金鑰
   - 確認網路連線
   - 系統會自動使用備用標題

4. **檔案下載失敗**
   - 確認 Google Drive 資料夾結構
   - 檢查檔案權限

## 📈 版本歷史

- **v2.0**: 互動式 AI 標題選擇流程 (目前版本)
- **v1.0**: 基礎自動化上傳流程

## 🤝 貢獻

歡迎提交 Issues 和 Pull Requests！

## 📄 授權

MIT License