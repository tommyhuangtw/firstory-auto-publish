#!/bin/bash

# 停止本地服務腳本

PROJECT_DIR="/Users/tommyhuang/Desktop/ai_projects/firstory-podcast-automation"
cd "$PROJECT_DIR"

echo "⏹️  停止 AI懶人報 服務..."

# 停止PM2管理的服務
if command -v pm2 &> /dev/null; then
    if pm2 list | grep -q "podcast-web-console"; then
        echo "🛑 停止 PM2 服務..."
        pm2 stop podcast-web-console
        pm2 delete podcast-web-console
        echo "✅ PM2 服務已停止"
    fi
fi

# 停止nohup進程
if [ -f "logs/web-console.pid" ]; then
    WEB_PID=$(cat logs/web-console.pid)
    if kill -0 "$WEB_PID" 2>/dev/null; then
        echo "🛑 停止 Web控制台 (PID: $WEB_PID)..."
        kill "$WEB_PID"
        rm -f logs/web-console.pid
        echo "✅ Web控制台已停止"
    else
        echo "⚠️  Web控制台進程不存在"
        rm -f logs/web-console.pid
    fi
fi

# 停止ngrok
if [ -f "logs/ngrok.pid" ]; then
    NGROK_PID=$(cat logs/ngrok.pid)
    if kill -0 "$NGROK_PID" 2>/dev/null; then
        echo "🛑 停止 ngrok (PID: $NGROK_PID)..."
        kill "$NGROK_PID"
        rm -f logs/ngrok.pid
        echo "✅ ngrok已停止"
    else
        echo "⚠️  ngrok進程不存在"
        rm -f logs/ngrok.pid
    fi
fi

# 檢查端口是否還被佔用
if lsof -i :8888 > /dev/null 2>&1; then
    echo "⚠️  端口 8888 仍被佔用，強制終止..."
    lsof -ti :8888 | xargs kill -9
fi

# 清理臨時檔案
rm -f ngrok.yml

echo "🧹 清理完成"
echo "✅ 所有服務已停止"