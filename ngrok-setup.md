# 🌐 ngrok 隧道設定指南

使用 ngrok 將本地 webhook 服務暴露給外網，讓遠程 n8n 可以訪問。

## 🚀 快速設定

### 1. 安裝 ngrok

```bash
# macOS (使用 Homebrew)
brew install ngrok/ngrok/ngrok

# 或者下載安裝包
# 前往: https://ngrok.com/download
```

### 2. 註冊 ngrok 帳戶

1. 前往 https://ngrok.com/ 註冊免費帳戶
2. 複製你的 authtoken
3. 設定 authtoken:

```bash
ngrok config add-authtoken YOUR_AUTHTOKEN_HERE
```

### 3. 啟動服務

**終端 1: 啟動 webhook 服務器**
```bash
npm run webhook
```

**終端 2: 啟動 ngrok 隧道**
```bash
ngrok http 3001
```

### 4. 獲取公開 URL

ngrok 會顯示類似這樣的輸出：
```
Forwarding  https://abc123.ngrok.io -> http://localhost:3001
```

你的公開 URL 就是: `https://abc123.ngrok.io`

## 🔗 n8n 整合

在 n8n 中使用你的 ngrok URL：

### HTTP Request 節點設定:
```json
{
  "method": "POST",
  "url": "https://YOUR-NGROK-URL.ngrok.io/upload/delayed",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "delayMinutes": 10,
    "taskId": "n8n-task-{{ $now }}"
  }
}
```

## 📋 完整操作步驟

1. **啟動本地服務**: `npm run webhook`
2. **啟動 ngrok**: `ngrok http 3001`  
3. **複製 ngrok URL**: 例如 `https://abc123.ngrok.io`
4. **在 n8n 中使用**: 將 localhost:3001 替換為 ngrok URL
5. **測試**: `curl https://abc123.ngrok.io/health`

## ⚠️ 注意事項

- 免費版每次重啟會產生新的 URL
- ngrok 必須保持運行
- 適合開發和測試使用

## 🎯 自動化腳本

創建一個啟動腳本：

```bash
#!/bin/bash
echo "🚀 啟動 Firstory Webhook 服務..."
echo "================================"

# 啟動 webhook 服務器 (背景執行)
npm run webhook &
WEBHOOK_PID=$!

# 等待服務器啟動
sleep 3

# 啟動 ngrok
echo "🌐 啟動 ngrok 隧道..."
ngrok http 3001

# 清理程序
kill $WEBHOOK_PID
``` 