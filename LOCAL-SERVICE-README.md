# 🏠 本地永久服務設置指南

AI懶人報 Web控制台 - 本地永久運行方案

## 🎯 方案優勢

✅ **保持SoundOn登入狀態** - 避免重複登入問題  
✅ **完全控制權** - 在自己電腦上運行  
✅ **公網訪問** - 通過域名或ngrok訪問  
✅ **永久運行** - 支援自動重啟和後台運行  

---

## 🚀 快速開始

### **方案一：ngrok (推薦新手)**

```bash
# 1. 啟動本地服務
./scripts/start-local-service.sh

# 2. 設置ngrok公網訪問
./scripts/setup-ngrok.sh

# 完成！現在可以通過公網URL訪問
```

### **方案二：購買域名 + Cloudflare**

```bash
# 1. 購買域名 (如: podcast.yourdomain.com)
# 2. 設置Cloudflare DNS
# 3. 安裝cloudflared
brew install cloudflared

# 4. 設置tunnel
cloudflared tunnel login
cloudflared tunnel create podcast-automation
cloudflared tunnel route dns podcast-automation podcast.yourdomain.com

# 5. 啟動服務
./scripts/start-local-service.sh
cloudflared tunnel run podcast-automation
```

### **方案三：Docker容器 (最穩定)**

```bash
# 一鍵設置Docker服務
./scripts/setup-local-docker.sh
```

---

## 📋 管理命令

### **服務管理**
```bash
# 啟動服務
./scripts/start-local-service.sh

# 停止服務  
./scripts/stop-local-service.sh

# 查看服務狀態
curl http://localhost:8888/health
```

### **ngrok管理**
```bash
# 設置ngrok
./scripts/setup-ngrok.sh

# 查看ngrok狀態
curl http://localhost:4040/api/tunnels

# ngrok控制台
open http://localhost:4040
```

### **Docker管理**
```bash
# 查看容器狀態
docker-compose -f docker-compose.local.yml ps

# 查看日誌
docker-compose -f docker-compose.local.yml logs -f

# 重啟容器
docker-compose -f docker-compose.local.yml restart
```

---

## 🔧 環境配置

確保 `.env` 檔案包含以下配置：

```env
# Web Console Configuration
WEB_CONSOLE_PORT=8888
PUBLIC_URL=http://localhost:8888

# 其他現有配置...
```

---

## 📱 使用方式

1. **啟動服務**：選擇上述任一方案啟動
2. **訪問控制台**：
   - 本地：http://localhost:8888
   - 公網：你的ngrok或域名URL
3. **觸發上傳**：點擊"開始上傳Podcast"按鈕
4. **選擇標題**：在收到的Gmail中點選標題
5. **自動完成**：系統自動完成上傳到SoundOn

---

## 🛡️ 自動啟動設置

### **macOS LaunchAgent**

創建自動啟動服務：

```bash
# 創建LaunchAgent配置
cat > ~/Library/LaunchAgents/com.podcast.automation.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.podcast.automation</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/Users/tommyhuang/Desktop/ai_projects/firstory-podcast-automation/scripts/start-local-service.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/tommyhuang/Desktop/ai_projects/firstory-podcast-automation/logs/launchd.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/tommyhuang/Desktop/ai_projects/firstory-podcast-automation/logs/launchd.error.log</string>
</dict>
</plist>
EOF

# 載入服務
launchctl load ~/Library/LaunchAgents/com.podcast.automation.plist

# 啟動服務
launchctl start com.podcast.automation
```

---

## 📊 監控和日誌

### **查看日誌**
```bash
# Web控制台日誌
tail -f logs/web-console.log

# ngrok日誌
tail -f logs/ngrok.log

# Docker日誌 (如果使用Docker)
docker-compose -f docker-compose.local.yml logs -f
```

### **健康檢查**
```bash
# 檢查服務狀態
curl http://localhost:8888/health

# 檢查進程
ps aux | grep node

# 檢查端口
lsof -i :8888
```

---

## 🎯 方案選擇建議

| 需求 | 推薦方案 | 優點 |
|------|----------|------|
| 快速測試 | ngrok | 5分鐘設置完成 |
| 長期使用 | 購買域名 + Cloudflare | 專業、穩定、免費 |
| 最大穩定性 | Docker | 環境隔離、自動重啟 |
| 本地開發 | 直接運行 | 便於調試和修改 |

---

## 🆘 常見問題

### **服務無法啟動**
```bash
# 檢查端口是否被佔用
lsof -i :8888

# 檢查Node.js版本
node --version

# 檢查依賴
cd web-console && npm install
```

### **ngrok連接失敗**
```bash
# 檢查authtoken
ngrok config check

# 重新設置authtoken
ngrok config add-authtoken YOUR_TOKEN
```

### **SoundOn登入問題**
- 確保使用相同的瀏覽器profile
- 檢查 `temp/browser-data` 目錄權限
- 嘗試手動登入一次SoundOn

---

## 🎉 部署完成

選擇合適的方案，按照步驟執行，就能擁有一個可以從任何地方訪問的Podcast自動化系統！

**記住**：
- 🔒 保護好你的公網URL
- 📱 在手機上也能操作
- 🤖 保持SoundOn登入狀態
- ⏰ 支援定時任務觸發