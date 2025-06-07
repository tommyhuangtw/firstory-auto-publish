# Firstory Podcast 自動上傳系統

這是一個使用 Playwright 自動化上傳 Podcast 到 Firstory 的系統，整合了 Airtable、Google Drive 和 OpenAI LLM。

## 功能特色

- 🤖 自動從 Airtable 獲取待上傳的 Podcast 資料
- 📁 從 Google Drive 下載音檔和封面圖片
- 🧠 使用 LLM 優化標題和描述內容
- 🌐 使用 Playwright 自動化瀏覽器操作上傳到 Firstory
- ⏰ 支援定時自動執行
- 📊 完整的日誌記錄和錯誤處理

## 系統需求

- Node.js 16+
- Chrome 瀏覽器 (Playwright 會自動安裝)

## 安裝步驟

1. 安裝依賴套件
```bash
npm install
npm run install-playwright
```

2. 設定環境變數
```bash
cp .env.example .env
# 編輯 .env 檔案，填入各項設定
```

3. 設定 Google Drive 憑證
```bash
cp config/google-credentials.example.json config/google-credentials.json
# 編輯憑證檔案，填入你的 Google Service Account 資訊
```

## 設定說明

### Airtable 設定
在你的 Airtable Base 中，需要有以下欄位：
- `Title`: Podcast 標題
- `Content`: Podcast 內容摘要
- `Status`: 狀態 (設為 "Ready to Upload" 表示待上傳)
- `Audio File ID`: Google Drive 音檔 ID
- `Cover Image ID`: Google Drive 封面圖片 ID
- `Episode Number`: 集數編號
- `Tags`: 標籤
- `Scheduled Date`: 預定發布日期

### Google Drive 設定
1. 在 Google Cloud Console 建立服務帳戶
2. 下載 JSON 憑證檔案
3. 將檔案放置於 `config/google-credentials.json`
4. 確保服務帳戶有存取你的 Drive 檔案夾權限

## 使用方法

### 定時自動執行
```bash
npm start
```

### 測試執行
```bash
npm test
```

## 注意事項

- 首次執行建議設定 `HEADLESS=false` 以觀察瀏覽器操作
- 確保 Firstory 登入資訊正確
- 音檔和圖片檔案大小需符合 Firstory 限制
- 建議在測試環境先驗證流程

## 故障排除

如果遇到上傳失敗，請檢查：
1. 網路連線是否正常
2. Firstory 網站是否有變更介面
3. 檔案格式是否符合要求
4. 登入憑證是否有效