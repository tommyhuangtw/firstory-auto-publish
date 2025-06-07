# 🚀 Firstory 自動化上傳測試指南

## 📋 測試前準備清單

### 1. 環境變數設定
```bash
cd /Users/tommyhuang/Desktop/ai_projects/firstory-podcast-automation
cp .env.example .env
```

然後編輯 `.env` 文件，填入真實的資料：
- ✅ FIRSTORY_EMAIL (你的 Firstory 帳號)
- ✅ FIRSTORY_PASSWORD (你的 Firstory 密碼)
- ✅ AIRTABLE_API_KEY (Airtable Personal Access Token)
- ✅ GEMINI_API_KEY (Google Gemini API 金鑰)
- ✅ Google Drive 服務帳戶 JSON 檔案

### 2. 檢查 Airtable 資料
確認 Airtable Base: `app19Zwdzq4sWcREm` 中的 "Daily Podcast Summary" 表格有：
- ✅ 至少一筆 "Email html" 欄位有內容的記錄
- ✅ 記錄按照 Date 欄位排序（最新的在最上面）

### 3. 安裝依賴
```bash
npm install
npx playwright install
```

## 🧪 測試步驟

### 階段 1: 測試各個服務

#### 1.1 測試 LLM 服務
```bash
node src/test-llm.js
```
**預期結果**: 應該生成 10 個中文標題候選和最終選擇的標題

#### 1.2 測試 Airtable 連接
```bash
node -e "
const { AirtableService } = require('./src/services/airtable');
require('dotenv').config();
(async () => {
  const airtable = new AirtableService();
  const data = await airtable.getLatestPodcastData();
  console.log('Airtable 連接成功:', data ? '有資料' : '無資料');
  if (data) console.log('Email html 內容長度:', data.emailHtml?.length || 0);
})();
"
```

### 階段 2: 測試完整上傳流程

#### 2.1 測試模式（建議先執行）
```bash
# 設定為顯示瀏覽器視窗，方便觀察
export PLAYWRIGHT_HEADLESS=false
export DEBUG_MODE=true

# 執行測試
node src/main.js
```

#### 2.2 生產模式
```bash
# 設定為隱藏瀏覽器視窗
export PLAYWRIGHT_HEADLESS=true
export DEBUG_MODE=false

# 執行上傳
npm start
```

## 🔍 測試檢查點

### 第 1 步：Airtable 資料獲取
- [ ] 成功連接到 Airtable
- [ ] 成功獲取最新的 "Email html" 內容
- [ ] 內容不為空

### 第 2 步：LLM 內容生成
- [ ] 成功生成 10 個標題候選
- [ ] 成功選擇最佳標題
- [ ] 標題為繁體中文且無 emoji
- [ ] 標題包含具體工具名稱
- [ ] 成功生成描述內容

### 第 3 步：Firstory 自動化
- [ ] 成功開啟 Firstory 網站
- [ ] 成功登入
- [ ] 成功進入上傳頁面
- [ ] 成功填入標題
- [ ] 成功填入描述
- [ ] 成功提交表單

## 🐛 常見問題排除

### 問題 1: Airtable 連接失敗
```bash
# 檢查 API 金鑰和 Base ID
echo $AIRTABLE_API_KEY
echo $AIRTABLE_BASE_ID
```

### 問題 2: Gemini API 錯誤
```bash
# 檢查 API 金鑰
echo $GEMINI_API_KEY
# 測試 API 連接
node src/test-llm.js
```

### 問題 3: Playwright 錯誤
```bash
# 重新安裝瀏覽器
npx playwright install
# 檢查瀏覽器版本
npx playwright --version
```

### 問題 4: Firstory 登入失敗
- 檢查帳號密碼是否正確
- 確認沒有開啟兩步驟驗證
- 手動登入一次確認帳號狀態

## 📊 成功指標

✅ **完全成功**: 所有步驟都通過，Firstory 上可以看到新的 podcast 集數  
⚠️ **部分成功**: LLM 生成成功，但 Firstory 上傳失敗  
❌ **失敗**: 資料獲取或內容生成階段就失敗  

## 🔄 重複測試

如果要重複測試，確保：
1. Airtable 中有新的內容（或手動更新現有記錄的時間）
2. 清除之前的臨時檔案
3. 檢查 Firstory 上是否有重複的內容

## 🚀 正式部署

測試成功後，可以：
1. 設定定時執行: 修改 `UPLOAD_SCHEDULE` 環境變數
2. 使用 Docker 部署: `docker-compose up -d`
3. 監控日誌: `docker-compose logs -f`