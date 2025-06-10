# Firstory Podcast 自動上傳系統 - 使用說明

## 🚀 快速開始

### 1. 環境設定

複製 `env.example` 到 `.env` 並填入你的真實資訊：

```bash
cp env.example .env
```

確保你的 `.env` 檔案包含以下設定：

```bash
# Firstory 登入資訊
FIRSTORY_EMAIL=你的真實email@gmail.com
FIRSTORY_PASSWORD=你的真實密碼

# Google Drive OAuth 設定 (已設定)
GOOGLE_CLIENT_ID=964781321084-itebf8dakij4di8ohshikjhqc6o8utaa.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=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

# 其他設定 (可選)
PLAYWRIGHT_HEADLESS=false
```

### 2. Google Cloud Console 設定

在使用前，請確保在 [Google Cloud Console](https://console.cloud.google.com/) 中：

1. 進入「API 和服務」→「憑證」
2. 編輯你的 OAuth 2.0 用戶端 ID
3. 在「已授權的重新導向 URI」中新增：`http://localhost:8080`
4. 儲存變更

## 🧪 測試腳本

### 按順序執行以下測試：

#### 1. 測試 Google Drive 認證
```bash
npm run test-auth
# 或
node test-auth-only.js
```

#### 2. 測試 Google Drive 檔案下載
```bash
npm run test-google-drive
# 或  
node test-google-drive.js
```

#### 3. 測試 Firstory Studio 登入 ⭐ 新功能
```bash
npm run test-studio
# 或
node test-studio-upload.js
```

#### 4. 測試基本 Firstory 登入（舊版）
```bash
npm run test-firstory
# 或
node test-basic-upload.js
```

#### 5. 測試完整上傳流程（簡化版）
```bash
npm run test-simple
# 或
node test-simple-upload.js
```

## 📱 正式執行

### 上傳單集
```bash
npm start
# 或
node src/main.js
```

### 定時上傳（背景執行）
修改 `.env` 中的 `UPLOAD_SCHEDULE`（cron 格式），然後：
```bash
npm start
```

## 🔧 故障排除

### Google Drive 認證問題
- 確保重定向 URI 設定正確：`http://localhost:8080`
- 如果 tokens 過期，刪除 `temp/google-tokens.json` 重新授權

### Firstory 登入問題
- 檢查 `.env` 中的帳號密碼是否正確
- 確保沒有開啟兩步驟驗證
- 嘗試手動登入 Firstory 網站確認帳號狀態

### 檔案上傳問題
- 確保 Google Drive 文件夾有正確的檔案
- 檢查音檔和圖片格式是否被 Firstory 支援
- 確保網路連接穩定

## 📂 檔案結構

```
firstory-podcast-automation/
├── src/
│   ├── firstory-uploader.js      # 主要 Firstory 上傳邏輯
│   ├── main.js                   # 完整自動化流程
│   ├── uploader.js               # 上傳器包裝
│   └── services/
│       ├── googleDrive.js        # Google Drive 服務
│       ├── airtable.js           # Airtable 服務 (可選)
│       └── llm.js               # LLM 服務 (可選)
├── test-*.js                     # 各種測試腳本
├── temp/                         # 暫存檔案目錄
└── .env                          # 環境變數設定
```

## 💡 使用建議

1. **首次使用**：先執行所有測試腳本確保各部分都正常運作
2. **定期上傳**：設定 cron 表達式進行定時上傳
3. **監控日誌**：注意執行日誌中的錯誤訊息
4. **備份設定**：備份 `.env` 檔案和 Google tokens

## 🆘 支援

如果遇到問題：
1. 檢查所有測試腳本是否通過
2. 查看終端機的錯誤訊息
3. 確認所有必要的環境變數都已設定
4. 嘗試重新授權 Google Drive 

## ✨ 新功能說明

### Firstory Studio 支援
- ✅ 自動進入 `https://studio.firstory.me/dashboard`
- ✅ 智能識別 Studio 介面元素（資訊主頁、節目數據、AI Studio）
- ✅ 改善的上傳單集按鈕識別
- ✅ 強化的登入狀態檢查

### 使用流程
1. **自動登入檢查** - 先檢查是否已經登入 Studio
2. **智能導航** - 直接進入 Studio Dashboard
3. **一鍵上傳** - 點擊上傳單集按鈕
4. **自動填寫** - 標題、描述、音檔、IG 縮圖自動上傳
5. **Cookies 保持** - 下次免登入 