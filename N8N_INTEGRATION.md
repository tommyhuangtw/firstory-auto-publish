# 🔗 n8n 整合指南

將 Firstory Podcast 自動化腳本與 n8n 整合，實現智能化的延遲發佈流程。

## 🚀 快速開始

### 1. 啟動 Webhook 服務器

```bash
# 生產模式
npm run webhook

# 開發模式 (更多詳細日誌)
npm run webhook-dev
```

服務器將在 `http://localhost:3001` 運行

### 2. 測試 Webhook 服務

```bash
# 健康檢查
curl http://localhost:3001/health

# 測試立即上傳
curl -X POST http://localhost:3001/upload/immediate

# 測試延遲上傳 (10分鐘後執行)
curl -X POST http://localhost:3001/upload/delayed \
     -H "Content-Type: application/json" \
     -d '{"delayMinutes": 10}'
```

## 📡 API 端點說明

### 基本端點

| 方法 | 端點 | 說明 |
|------|------|------|
| `GET` | `/health` | 健康檢查和服務狀態 |
| `GET` | `/tasks` | 查看所有計劃任務 |

### 上傳端點

| 方法 | 端點 | 說明 | 參數 |
|------|------|------|------|
| `POST` | `/upload/immediate` | 立即執行上傳 | 無 |
| `POST` | `/upload/delayed` | 延遲執行上傳 | `delayMinutes`, `taskId` |
| `POST` | `/upload/test` | 測試模式上傳 | 無 |
| `DELETE` | `/upload/delayed/:taskId` | 取消延遲任務 | URL 參數 |

### 延遲上傳參數

```json
{
  "delayMinutes": 10,        // 延遲分鐘數 (預設: 10)
  "taskId": "my-task-123"    // 可選的任務ID (用於取消)
}
```

## 🔧 n8n 工作流程設定

### 方案 1: 基於時間觸發 (推薦)

```
📅 Schedule Trigger (定時)
   ↓
🌐 HTTP Request (呼叫延遲上傳)
   ↓
⏰ Wait 10 minutes
   ↓
📊 HTTP Request (檢查狀態)
```

#### n8n 節點配置

**1. Schedule Trigger 節點**
- 觸發時間: 每天早上 9:00
- 或者: 當 Podcast 內容生成完成後

**2. HTTP Request 節點 - 延遲上傳**
```json
{
  "method": "POST",
  "url": "http://localhost:3001/upload/delayed",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "delayMinutes": 10,
    "taskId": "daily-podcast-{{ $now }}"
  }
}
```

**3. Wait 節點**
- 等待時間: 11 分鐘 (比延遲時間多 1 分鐘)

**4. HTTP Request 節點 - 檢查結果**
```json
{
  "method": "GET",
  "url": "http://localhost:3001/health"
}
```

### 方案 2: 基於 Webhook 觸發

```
🎯 Webhook Trigger (外部觸發)
   ↓
🌐 HTTP Request (呼叫延遲上傳)
   ↓
📧 Email/Slack (通知已安排)
```

#### n8n 節點配置

**1. Webhook Trigger 節點**
- HTTP Method: POST
- Path: `/podcast-ready`

**2. HTTP Request 節點**
```json
{
  "method": "POST",
  "url": "http://localhost:3001/upload/delayed",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "delayMinutes": {{ $json.delayMinutes || 10 }},
    "taskId": "webhook-{{ $now }}"
  }
}
```

### 方案 3: 基於 Airtable 變化觸發

```
📊 Airtable Trigger (新記錄)
   ↓
🔍 Filter (檢查狀態)
   ↓
🌐 HTTP Request (延遲上傳)
   ↓
📊 Airtable Update (更新狀態)
```

## 🛠️ 進階配置

### 環境變數

在 `.env` 檔案中添加：

```bash
# Webhook 服務器設定
WEBHOOK_PORT=3001

# 其他現有設定...
GEMINI_API_KEY=your_key
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_secret
AIRTABLE_API_KEY=your_key
AIRTABLE_BASE_ID=your_base_id
```

### 服務器部署

如果要在伺服器上運行：

```bash
# 使用 PM2 管理程序
npm install -g pm2

# 啟動服務
pm2 start webhook-server.js --name "firstory-webhook"

# 查看狀態
pm2 status

# 查看日誌
pm2 logs firstory-webhook
```

### 防火牆設定

如果 n8n 和 webhook 服務器在不同機器上：

```bash
# 開放端口 3001
sudo ufw allow 3001
```

## 📊 監控和調試

### 查看計劃任務

```bash
curl http://localhost:3001/tasks
```

### 取消任務

```bash
curl -X DELETE http://localhost:3001/upload/delayed/task_1672734567890
```

### 日誌查看

服務器會輸出詳細日誌，包括：
- 📨 API 請求記錄
- ⏰ 延遲任務安排
- 🚀 任務執行狀態
- ❌ 錯誤信息

## 🎯 完整使用流程範例

### 場景：每天早上生成 Podcast，10分鐘後自動發佈

1. **n8n 工作流程**：
   ```
   Schedule (09:00) → HTTP Request (延遲上傳) → 完成
   ```

2. **實際執行時間線**：
   - 09:00 - n8n 觸發，呼叫 `/upload/delayed`
   - 09:00 - Webhook 服務器安排 10 分鐘後執行
   - 09:10 - 自動執行 Firstory 上傳流程
   - 09:15 - 上傳完成，Podcast 已發佈

3. **容錯機制**：
   - 如果上傳失敗，會記錄詳細錯誤日誌
   - 可以手動重新觸發或取消任務
   - 支援多個並行的延遲任務

## 🔧 故障排除

### 常見問題

**1. 無法連接到 webhook 服務器**
- 檢查服務器是否運行：`curl http://localhost:3001/health`
- 檢查端口是否被占用：`lsof -i :3001`

**2. n8n 請求失敗**
- 確認 n8n 可以訪問 `localhost:3001`
- 檢查防火牆設定
- 查看 n8n 和 webhook 服務器的日誌

**3. 延遲任務沒有執行**
- 檢查任務是否在列表中：`GET /tasks`
- 查看服務器日誌是否有錯誤
- 確認服務器沒有重啟 (重啟會清除記憶中的任務)

**4. Google Drive 認證問題**
- 確認 `google-token.json` 文件存在
- 重新執行 OAuth 認證：`npm run oauth-simple`

## 📈 監控建議

1. **設定健康檢查**：定期 ping `/health` 端點
2. **日誌監控**：監控錯誤日誌和執行狀態
3. **通知設定**：在 n8n 中設定成功/失敗通知
4. **備份機制**：設定手動觸發的備用流程

## 🎉 總結

透過這個 webhook 整合，你可以：

✅ 完全自動化 Podcast 發佈流程  
✅ 精確控制發佈時間  
✅ 與現有的 n8n 工作流程無縫整合  
✅ 支援並行處理多個任務  
✅ 具備完整的錯誤處理和監控功能  

現在你的 Podcast 製作到發佈可以完全自動化了！🚀 