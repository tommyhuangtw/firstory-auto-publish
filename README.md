# Podcast Automation System

自動化 Podcast 上傳系統，支援 Firstory 和 SoundOn 平台，整合 Google Drive 檔案管理。

## 功能特色

- ✅ **Google Drive 整合**: 自動從 Google Drive 下載最新音檔
- ✅ **多平台支援**: 支援 Firstory 和 SoundOn 兩大 Podcast 平台  
- ✅ **自動化上傳**: 完整的自動化上傳流程
- ✅ **智能內容生成**: 自動生成標題和描述
- ✅ **瀏覽器自動化**: 使用 Playwright 進行網頁操作
- ✅ **登入狀態管理**: 持久化 cookies 管理
- ✅ **詳細日誌**: 完整的操作記錄

## 支援平台

### SoundOn (新增)
- 自動登入 SoundOn 平台
- 從 Google Drive 下載最新音檔
- 自動填寫單集資訊
- 設定廣告選項
- 儲存為草稿

### Firstory (原有)
- 完整的 Firstory Studio 上傳流程
- 支援音檔和封面上傳
- 自動發布設定

## 環境要求

- Node.js 16+
- Google Cloud Console 專案 (用於 Google Drive API)

## 安裝設定

### 1. 安裝依賴
```bash
npm install
```

### 2. Google Drive API 設定
1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立新專案或選擇現有專案
3. 啟用 Google Drive API
4. 建立 OAuth 2.0 客戶端 ID
5. 下載 credentials.json 並放置在專案根目錄

### 3. 環境變數設定
複製 `.env.example` 為 `.env` 並填入設定：

```bash
# Google OAuth 設定
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret

# Playwright 設定
PLAYWRIGHT_HEADLESS=false
```

## 使用方式

### SoundOn 自動化 (推薦)

完整的 SoundOn 自動化流程：
```bash
npm run soundon-automation
```

### 測試功能

測試 SoundOn 登入：
```bash
npm run soundon-login
```

測試 Google Drive 連接：
```bash
npm run test-google-drive
```

### Firstory 相關 (舊版)

```bash
# Firstory Studio 上傳
npm run test-studio

# 手動登入測試
npm run manual-login
```

## 自動化流程

### SoundOn 自動化流程

1. **Google Drive 認證**: 自動進行 OAuth 認證
2. **獲取最新檔案**: 從 "Audio" 資料夾下載最新音檔
3. **SoundOn 登入**: 自動登入 SoundOn 平台
4. **建立新單集**: 點擊新增單集按鈕
5. **上傳音檔**: 上傳下載的音檔
6. **填寫資訊**: 自動填寫標題和描述
7. **設定選項**: 
   - 選擇 "一般單集"
   - 廣告設定選擇 "否"
8. **儲存草稿**: 完成後儲存為草稿

### 檔案結構

```
src/
├── soundon-uploader.js     # SoundOn 上傳器
├── soundon-automation.js   # SoundOn 自動化主程式
├── google-drive.js         # Google Drive 服務
├── firstory-uploader.js    # Firstory 上傳器 (舊版)
└── utils/
    └── logger.js           # 日誌工具

test-soundon-login.js       # SoundOn 登入測試
temp/                       # 暫存目錄
├── downloads/              # 音檔下載目錄
├── browser-data/           # 瀏覽器資料
└── *.json                  # Cookies 和 tokens
```

## Google Drive 資料夾結構

請確保你的 Google Drive 有以下資料夾結構：

```
Google Drive/
├── Audio/          # 存放音檔 (.mp3)
└── Cover/          # 存放封面圖片 (.jpg, .png)
```

## 故障排除

### 常見問題

1. **Google Drive 認證失敗**
   - 確認 credentials.json 檔案存在
   - 檢查 Google Cloud Console 中的 API 設定
   - 刪除 `temp/tokens.json` 重新認證

2. **SoundOn 登入失敗**
   - 確認帳號密碼正確
   - 檢查網路連線
   - 清除瀏覽器暫存資料

3. **檔案上傳失敗**
   - 確認音檔格式為 .mp3
   - 檢查檔案大小限制
   - 確認網路穩定

### 日誌檢查

系統會自動記錄詳細的操作日誌，出現問題時請檢查 console 輸出。

## 開發

### 新增平台支援

要新增其他 Podcast 平台支援，請參考 `src/soundon-uploader.js` 的結構建立新的上傳器類別。

### 自定義內容生成

修改 `src/soundon-automation.js` 中的 `generateEpisodeInfo` 方法來自定義標題和描述的生成邏輯。

## 授權

MIT License

## 貢獻

歡迎提交 Issues 和 Pull Requests！