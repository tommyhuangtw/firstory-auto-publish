# Firstory Podcast Automation 使用指南

完整的 Firstory Podcast 自動化上傳系統，整合了 Airtable、Google Drive、LLM 內容生成和 Firstory 上傳功能。

## 🚀 快速開始

### 1. 安裝相依套件
```bash
npm install
npm run install-playwright
```

### 2. 設定環境變數
創建 `.env` 檔案：
```env
# LLM 服務 (Gemini)
GEMINI_API_KEY=your_gemini_api_key

# Google Drive 直接連結 (簡化版 - 只需要分享連結)
GOOGLE_DRIVE_AUDIO_URL=https://drive.google.com/file/d/YOUR_AUDIO_FILE_ID/view
GOOGLE_DRIVE_COVER_URL=https://drive.google.com/file/d/YOUR_COVER_FILE_ID/view

# Airtable
AIRTABLE_API_KEY=your_airtable_api_key
AIRTABLE_BASE_ID=app19Zwdzq4sWcREm

# 可選設定
UPLOAD_SCHEDULE=0 9 * * *
PLAYWRIGHT_HEADLESS=false
NODE_ENV=development
```

### 3. 設定 Google Drive 連結
1. 在 Google Drive 中找到你的音檔和封面圖片
2. 右鍵點擊檔案 → 「取得連結」
3. 設定為「知道連結的任何人」
4. 複製連結並貼到 `.env` 檔案中

### 4. 第一次設定
```bash
# 檢查系統狀態
npm run status

# 測試運行
npm run test
```

## 📋 使用方式

### 執行模式

#### 單次執行 (預設)
```bash
npm start
# 或
npm run upload
# 或
node run-automation.js once
```

#### 測試模式
```bash
npm run test
# 或
node run-automation.js test
```

#### 定時執行模式
```bash
npm run scheduled
# 或
node run-automation.js scheduled
```

#### 清理舊檔案
```bash
npm run cleanup
# 或
node run-automation.js cleanup
```

#### 檢查系統狀態
```bash
npm run status
# 或
node run-automation.js status
```

#### 開發模式
```bash
npm run dev
```

## 🔄 完整流程

### 自動化流程步驟：

1. **📊 Airtable 資料獲取**
   - 從 Airtable 獲取待上傳的 Podcast 資料
   - 包含 emailHtml 內容用於 LLM 生成

2. **📁 Google Drive 檔案下載**
   - 使用提供的分享連結直接下載音檔 (.mp3)
   - 使用提供的分享連結直接下載封面圖片 (.png)
   - 自動重新命名檔案確保正確副檔名

3. **🤖 LLM 內容生成**
   - 生成 10 個候選標題
   - 從候選標題中選擇最佳標題
   - 生成完整的 Podcast 描述

4. **🚀 Firstory 自動上傳**
   - 自動導航到上傳頁面
   - 填寫標題
   - 上傳音檔
   - 清空並填寫新描述
   - 上傳封面圖片
   - 檢查所有內容完成
   - 點擊下一步
   - 自動發佈

5. **📊 狀態更新**
   - 更新 Airtable 上傳狀態
   - 記錄上傳詳細資訊

## 🔧 配置選項

### 環境變數說明

| 變數名 | 說明 | 必需 | 範例 |
|--------|------|------|------|
| `GEMINI_API_KEY` | Google Gemini API 金鑰 | ✅ | `AIzaSy...` |
| `GOOGLE_DRIVE_AUDIO_URL` | 音檔的 Google Drive 分享連結 | ✅ | `https://drive.google.com/file/d/1ABC.../view` |
| `GOOGLE_DRIVE_COVER_URL` | 封面的 Google Drive 分享連結 | ✅ | `https://drive.google.com/file/d/1DEF.../view` |
| `AIRTABLE_API_KEY` | Airtable API 金鑰 | ✅ | `pat...` |
| `AIRTABLE_BASE_ID` | Airtable Base ID | ✅ | `app19Zwdzq4sWcREm` |
| `UPLOAD_SCHEDULE` | 定時上傳時間 (cron 格式) | ❌ | `0 9 * * *` |
| `PLAYWRIGHT_HEADLESS` | 是否無頭模式運行 | ❌ | `false` |
| `NODE_ENV` | 運行環境 | ❌ | `development` |

### Google Drive 連結設定步驟

1. **取得音檔分享連結**：
   ```
   1. 在 Google Drive 中找到音檔
   2. 右鍵 → 「取得連結」
   3. 設定為「知道連結的任何人」可檢視
   4. 複製連結（類似：https://drive.google.com/file/d/1ABC123.../view）
   5. 貼到 GOOGLE_DRIVE_AUDIO_URL
   ```

2. **取得封面分享連結**：
   ```
   1. 在 Google Drive 中找到封面圖片
   2. 右鍵 → 「取得連結」
   3. 設定為「知道連結的任何人」可檢視
   4. 複製連結（類似：https://drive.google.com/file/d/1DEF456.../view）
   5. 貼到 GOOGLE_DRIVE_COVER_URL
   ```

#### 🔗 從文件夾設定個別檔案連結

如果你有文件夾連結，需要轉換為個別檔案連結：

**音檔文件夾範例**：
```
文件夾連結：https://drive.google.com/drive/folders/1pB2PaU9BAKi0IGbIgudUEm29bgPhX1jq
↓ 打開文件夾，找到最新音檔 ↓
個別檔案：daily_podcast_chinese_2025-06-06.mp3
↓ 右鍵 → 取得連結 ↓
正確連結：https://drive.google.com/file/d/檔案ID/view
```

**圖片文件夾範例**：
```
文件夾連結：https://drive.google.com/drive/folders/1BCSiZXS8aGnMdOnfJfAbwgitFfliVbQ-
↓ 打開文件夾，找到最新圖片 ↓
個別檔案：8A2B8735-976E-48FC-AE86-A07FAAEE0ED7.png
↓ 右鍵 → 取得連結 ↓
正確連結：https://drive.google.com/file/d/檔案ID/view
```

**設定指導工具**：
```bash
# 執行設定指導
node setup-drive-links.js
```

⚠️ **重要注意事項**：
- 必須使用個別檔案的分享連結，不能使用文件夾連結
- 連結格式必須包含 `/file/d/` 而不是 `/folders/`
- 每次有新檔案時，記得更新 `.env` 中的連結

### 定時排程格式

使用 cron 格式設定 `UPLOAD_SCHEDULE`：

```bash
# 每天早上 9 點
UPLOAD_SCHEDULE="0 9 * * *"

# 每週一早上 8 點
UPLOAD_SCHEDULE="0 8 * * 1"

# 每小時執行
UPLOAD_SCHEDULE="0 * * * *"
```

## 📁 檔案結構

```
firstory-podcast-automation/
├── run-automation.js          # 主要執行腳本
├── src/
│   ├── main.js               # 核心自動化邏輯
│   ├── firstory-uploader.js  # Firstory 上傳器
│   ├── services/
│   │   ├── airtable.js       # Airtable 服務
│   │   ├── googleDrive.js    # Google Drive 服務 (簡化版)
│   │   └── llm.js            # LLM 內容生成服務
│   └── utils/
│       └── logger.js         # 日誌工具
├── temp/                     # 臨時檔案目錄
└── .env                      # 環境變數
```

## 🛠️ 故障排除

### 常見問題

#### 1. Google Drive 下載失敗
- 確認 Google Drive 連結設定為「知道連結的任何人」可檢視
- 檢查連結格式是否正確
- 確認檔案沒有被刪除或移動

#### 2. 瀏覽器登入問題
- 確保已手動登入 Google 帳號 (使用無痕模式)
- 檢查 cookies 是否已保存

#### 3. 檔案上傳失敗
- 檢查檔案是否已下載到 `temp/` 目錄
- 確認檔案格式正確 (.mp3, .png)

#### 4. LLM 生成失敗
- 檢查 `GEMINI_API_KEY` 是否正確
- 確認 API 配額未用完

#### 5. Airtable 連接失敗
- 檢查 `AIRTABLE_API_KEY` 和 `AIRTABLE_BASE_ID`
- 確認 Airtable 權限設定

### 除錯模式

```bash
# 開啟詳細錯誤資訊
NODE_ENV=development npm run dev

# 檢查系統狀態
npm run status
```

## 📊 監控與日誌

### 日誌位置
- 系統日誌：控制台輸出
- 錯誤記錄：自動記錄到 Airtable

### 監控指標
- 上傳成功率
- 檔案下載狀態
- LLM 生成品質
- 執行時間

## 🔄 維護

### 定期維護
```bash
# 清理舊檔案 (超過 24 小時)
npm run cleanup

# 檢查系統狀態
npm run status
```

### 更新檢查
- 定期檢查 npm 套件更新
- 監控 Playwright 版本相容性
- 檢查 API 版本變更

## 🚀 部署建議

### 生產環境
1. 設定 `PLAYWRIGHT_HEADLESS=true`
2. 使用 PM2 或類似工具管理進程
3. 設定日誌輪替
4. 配置監控告警

### 優勢
- **簡化設定**：不需要複雜的 Google API OAuth 流程
- **直接下載**：使用分享連結直接下載檔案
- **易於管理**：只需要更新 Google Drive 連結即可
- **靈活性**：可以隨時更換不同的檔案

## 📞 支援

如有問題，請檢查：
1. Google Drive 分享連結是否正確設定
2. 環境變數設定
3. 相依套件版本
4. API 配額狀態
5. 網路連接狀況 