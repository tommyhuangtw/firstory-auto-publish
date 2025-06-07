# Google Drive API 設定指南

## 概述

使用 Google Drive API 可以直接從 Google Drive 文件夾下載最新檔案，無需個別分享連結。

## 設定步驟

### 1. 創建 Google Cloud 專案

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 創建新專案或選擇現有專案
3. 啟用 Google Drive API

### 2. 創建 OAuth 2.0 認證

1. 在 Google Cloud Console 中，前往 **APIs & Services** > **Credentials**
2. 點擊 **Create Credentials** > **OAuth 2.0 Client IDs**
3. 應用程式類型選擇 **Desktop application**
4. 設定名稱（例如：Podcast Automation）
5. 點擊 **Create**

### 3. 獲取認證資訊

創建完成後，你會得到：
- **Client ID**: 類似 `1234567890-abcdef.apps.googleusercontent.com`
- **Client Secret**: 類似 `GOCSPX-abcdefghijklmnop`

## 使用方式

### 方法 1: 直接提供認證資訊（推薦）

```bash
node download-with-api.js --client-id="YOUR_CLIENT_ID" --client-secret="YOUR_CLIENT_SECRET"
```

### 方法 2: 使用環境變數

在 `.env` 檔案中添加：
```
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
```

然後執行：
```bash
npm run download-api
```

### 方法 3: 互動模式

直接執行腳本，程式會提示你輸入認證資訊：
```bash
npm run download-api
```

## OAuth 認證流程

第一次使用時，需要完成 OAuth 認證：

1. 執行下載命令
2. 程式會顯示一個 Google 認證連結
3. 在瀏覽器中打開連結
4. 完成 Google 授權
5. 複製授權碼
6. 執行以下命令設定授權碼：

```bash
node -e "require('./download-with-api').setAuthCode('YOUR_AUTH_CODE')"
```

7. 重新執行下載命令

## 自動化設定

完成首次認證後，系統會自動儲存 token，後續使用不需要重複認證。

## 優勢

✅ **直接 API 訪問**: 不受 Google Drive 分享連結限制  
✅ **自動檔案識別**: 自動找到文件夾中最新的音檔和圖片  
✅ **完整檔案資訊**: 獲取檔案大小、修改時間等詳細資訊  
✅ **可靠下載**: 使用官方 API，下載成功率更高  

## 故障排除

### 問題: "找不到 Google 認證資訊"
**解決**: 確保提供了正確的 Client ID 和 Client Secret

### 問題: "需要完成 OAuth 認證流程"
**解決**: 按照上述 OAuth 認證流程完成認證

### 問題: "獲取文件夾內容失敗"
**解決**: 
1. 確保文件夾設為公開或你有訪問權限
2. 檢查文件夾 ID 是否正確
3. 確認已啟用 Google Drive API

### 問題: Token 過期
**解決**: 刪除 `google-token.json` 檔案並重新認證

## 檔案結構

```
firstory-podcast-automation/
├── src/services/googleDriveAPI.js    # Google Drive API 服務
├── download-with-api.js              # API 下載腳本
├── google-token.json                 # OAuth token（自動生成）
└── file-paths.json                   # 下載的檔案路徑
```

## 下一步

設定完成後，你可以：

1. **下載檔案**: `npm run download-api`
2. **測試上傳**: `npm run test`
3. **正式上傳**: `npm start`

## 安全提示

⚠️ **不要分享你的 Client Secret**  
⚠️ **不要將認證檔案提交到版本控制系統**  
⚠️ **定期檢查 Google Cloud Console 中的 API 使用情況** 