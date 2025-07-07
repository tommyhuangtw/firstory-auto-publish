#!/bin/bash

# AI懶人報 - 本地永久服務啟動腳本

set -e

PROJECT_DIR="/Users/tommyhuang/Desktop/ai_projects/firstory-podcast-automation"
cd "$PROJECT_DIR"

echo "🎙️ 啟動 AI懶人報 Web控制台..."
echo "📂 專案目錄: $PROJECT_DIR"
echo "⏰ 啟動時間: $(date)"

# 檢查Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安裝"
    exit 1
fi

# 檢查依賴
if [ ! -d "web-console/node_modules" ]; then
    echo "📦 安裝Web控制台依賴..."
    cd web-console
    npm install
    cd ..
fi

# 檢查環境配置
if [ ! -f ".env" ]; then
    echo "❌ 找不到 .env 檔案"
    exit 1
fi

# 創建日誌目錄
mkdir -p logs

# 啟動服務
echo "🚀 啟動Web控制台服務..."
cd web-console

# 使用PM2管理進程 (如果有安裝)
if command -v pm2 &> /dev/null; then
    pm2 start server.js --name "podcast-web-console" --log "../logs/web-console.log"
    pm2 save
    echo "✅ 服務已通過PM2啟動"
    echo "📊 查看狀態: pm2 status"
    echo "📋 查看日誌: pm2 logs podcast-web-console"
else
    echo "💡 建議安裝PM2進行進程管理: npm install -g pm2"
    echo "🔄 使用Forever模式啟動..."
    
    # 使用nohup後台運行
    nohup node server.js > ../logs/web-console.log 2>&1 &
    echo $! > ../logs/web-console.pid
    
    echo "✅ 服務已後台啟動"
    echo "📋 查看日誌: tail -f logs/web-console.log"
    echo "⏹️  停止服務: kill $(cat logs/web-console.pid)"
fi

sleep 2

# 檢查服務狀態
if curl -f http://localhost:8888/health > /dev/null 2>&1; then
    echo "✅ 服務運行正常"
    echo "📍 本地訪問: http://localhost:8888"
    
    # 讀取PUBLIC_URL
    PUBLIC_URL=$(grep PUBLIC_URL ../.env | cut -d '=' -f2)
    echo "🌍 公開訪問: $PUBLIC_URL"
else
    echo "❌ 服務啟動失敗"
    exit 1
fi

echo ""
echo "🎉 AI懶人報 Web控制台已成功啟動！"