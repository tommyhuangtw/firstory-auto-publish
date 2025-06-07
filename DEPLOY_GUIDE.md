# ☁️ 雲服務部署指南

將 Firstory Webhook 服務部署到免費雲平台，讓 n8n 可以穩定訪問。

## 🚀 方案選擇

| 平台 | 優點 | 缺點 | 推薦度 |
|------|------|------|--------|
| **Vercel** | 免費、簡單、穩定 | 無法處理長時間任務 | ⭐⭐⭐⭐⭐ |
| **Railway** | 支援長時間任務 | 免費額度有限 | ⭐⭐⭐⭐ |
| **Render** | 功能完整 | 免費版會休眠 | ⭐⭐⭐ |

## 🌐 方案 1: Vercel 部署 (推薦)

### 優點:
- ✅ 完全免費
- ✅ 自動 HTTPS
- ✅ 全球 CDN
- ✅ 簡單部署

### 限制:
- ⚠️ 函數執行時間最長 10 秒 (業餘版)
- ⚠️ 無法處理超過 10 秒的上傳任務

### 部署步驟:

1. **安裝 Vercel CLI**
```bash
npm install -g vercel
```

2. **登入 Vercel**
```bash
vercel login
```

3. **部署項目**
```bash
vercel
```

4. **設定環境變數**
```bash
# 在 Vercel 網站上設定或使用 CLI
vercel env add GEMINI_API_KEY
vercel env add GOOGLE_CLIENT_ID
vercel env add GOOGLE_CLIENT_SECRET
vercel env add AIRTABLE_API_KEY
vercel env add AIRTABLE_BASE_ID
```

5. **獲取部署 URL**
例如: `https://your-project.vercel.app`

## 🚂 方案 2: Railway 部署

### 優點:
- ✅ 支援長時間任務
- ✅ 永久運行
- ✅ 簡單設定

### 部署步驟:

1. **前往 Railway.app**
   - 訪問: https://railway.app/
   - 用 GitHub 登入

2. **新建項目**
   - 點擊 "New Project"
   - 選擇 "Deploy from GitHub repo"

3. **連接 GitHub**
   - 上傳你的代碼到 GitHub
   - 選擇該 repository

4. **設定環境變數**
   在 Railway 控制台設定:
   ```
   GEMINI_API_KEY=your_key
   GOOGLE_CLIENT_ID=your_client_id
   GOOGLE_CLIENT_SECRET=your_secret
   AIRTABLE_API_KEY=your_key
   AIRTABLE_BASE_ID=your_base_id
   PORT=3001
   ```

5. **部署**
   Railway 會自動部署並提供 URL

## 🎯 方案 3: Hostinger 部署

### 檢查 Hostinger 支援:

1. **登入 Hostinger 控制台**
2. **檢查是否支援 Node.js**
   - 查看 "Web Hosting" 或 "VPS" 選項
   - 是否有 Node.js 應用程式選項

3. **如果支援 Node.js**:
   ```bash
   # 上傳文件到 Hostinger
   # 安裝依賴
   npm install
   
   # 啟動服務
   npm run webhook
   ```

4. **如果不支援 Node.js**:
   - 考慮升級到 VPS 方案
   - 或使用其他免費雲服務

## 🔧 修改 Webhook 服務器 (適應雲部署)

由於雲平台的限制，我們需要修改服務器：

### 針對 Vercel 的修改:

```javascript
// 由於 Vercel 無法處理長時間任務，我們改用外部排程服務
// 或者將任務分解為多個短時間操作
```

### 針對 Railway 的修改:

```javascript
// Railway 支援長時間任務，可以保持原有邏輯
// 只需要設定正確的環境變數
```

## 📋 完整部署流程

### 使用 Vercel (最簡單):

1. **準備代碼**
```bash
# 確保所有文件都在項目中
git init
git add .
git commit -m "Initial commit"
```

2. **部署**
```bash
vercel
```

3. **設定環境變數**
```bash
vercel env add GEMINI_API_KEY
vercel env add GOOGLE_CLIENT_ID  
vercel env add GOOGLE_CLIENT_SECRET
vercel env add AIRTABLE_API_KEY
vercel env add AIRTABLE_BASE_ID
```

4. **測試**
```bash
curl https://your-project.vercel.app/health
```

5. **在 n8n 中使用**
```json
{
  "method": "POST",
  "url": "https://your-project.vercel.app/upload/delayed",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "delayMinutes": 10
  }
}
```

## 🎯 推薦流程

1. **立即使用**: ngrok (測試用)
2. **短期使用**: Vercel (如果上傳時間 < 10 秒)
3. **長期使用**: Railway 或 Render
4. **企業使用**: Hostinger VPS

## 🔧 故障排除

### Vercel 部署問題:
- 檢查 `vercel.json` 配置
- 確認環境變數設定正確
- 查看部署日誌

### Railway 部署問題:
- 檢查 `package.json` 中的 start 腳本
- 確認端口設定正確
- 查看應用程式日誌

### 環境變數問題:
- 確認所有必需的環境變數都已設定
- 檢查變數名稱拼寫
- 測試本地連接

你想要用哪個方案？我推薦從 **ngrok** 開始測試，然後選擇 **Railway** 做長期部署。 