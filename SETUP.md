# 快速設定指南

## 1. 環境設定

複製環境變數檔案並填寫設定：
```bash
cp .env.example .env
```

需要設定的項目：
- `FIRSTORY_EMAIL`: 你的 Firstory 帳號
- `FIRSTORY_PASSWORD`: 你的 Firstory 密碼
- `AIRTABLE_API_KEY`: Airtable API 金鑰
- `AIRTABLE_BASE_ID`: Airtable Base ID
- `OPENAI_API_KEY`: OpenAI API 金鑰

## 2. Google Drive 設定

1. 到 Google Cloud Console 建立服務帳戶
2. 下載 JSON 憑證檔案
3. 重新命名為 `google-credentials.json` 並放到 `config/` 資料夾

## 3. Airtable 表格結構

確保你的 Airtable 表格有以下欄位：
- `Title` (文字): Podcast 標題
- `Content` (長文字): 內容摘要
- `Status` (單選): 狀態 (包含 "Ready to Upload" 選項)
- `Audio File ID` (文字): Google Drive 音檔 ID
- `Cover Image ID` (文字): Google Drive 封面圖片 ID
- `Episode Number` (數字): 集數編號

## 4. 執行系統

```bash
# 一鍵啟動
./start.sh

# 或手動執行
npm install
npm run install-playwright
npm start
```

## 5. 測試

```bash
npm test
```

這會執行一次上傳流程，建議先用測試模式確認一切正常。