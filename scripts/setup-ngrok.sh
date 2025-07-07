#!/bin/bash

# ngrok 設置腳本 - 暴露本地服務到公網

set -e

PROJECT_DIR="/Users/tommyhuang/Desktop/ai_projects/firstory-podcast-automation"
cd "$PROJECT_DIR"

echo "🌐 設置 ngrok 公網訪問..."

# 檢查ngrok是否安裝
if ! command -v ngrok &> /dev/null; then
    echo "📦 安裝 ngrok..."
    if command -v brew &> /dev/null; then
        brew install ngrok
    else
        echo "❌ 請先安裝 Homebrew 或手動安裝 ngrok"
        echo "   Homebrew: /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        echo "   ngrok: https://ngrok.com/download"
        exit 1
    fi
fi

# 檢查是否已設置authtoken
if ! ngrok config check > /dev/null 2>&1; then
    echo "🔑 請設置您的 ngrok authtoken:"
    echo "   1. 前往 https://dashboard.ngrok.com/auth"
    echo "   2. 複製您的 authtoken"
    echo "   3. 執行: ngrok config add-authtoken YOUR_TOKEN"
    echo ""
    read -p "請輸入您的 ngrok authtoken: " NGROK_TOKEN
    
    if [ -n "$NGROK_TOKEN" ]; then
        ngrok config add-authtoken "$NGROK_TOKEN"
        echo "✅ ngrok authtoken 設置完成"
    else
        echo "❌ 未提供 authtoken"
        exit 1
    fi
fi

# 確保Web控制台正在運行
if ! curl -f http://localhost:8888/health > /dev/null 2>&1; then
    echo "⚠️  Web控制台未運行，正在啟動..."
    ./scripts/start-local-service.sh
    sleep 5
fi

# 啟動ngrok
echo "🚀 啟動 ngrok tunnel..."
echo "📍 將 localhost:8888 暴露到公網..."

# 使用配置檔案啟動ngrok
cat > ngrok.yml << EOF
version: "2"
authtoken_from_env: true
tunnels:
  podcast-web:
    addr: 8888
    proto: http
    inspect: true
    bind_tls: true
EOF

# 後台啟動ngrok
nohup ngrok start --config=ngrok.yml podcast-web > logs/ngrok.log 2>&1 &
echo $! > logs/ngrok.pid

echo "⏰ 等待 ngrok 啟動..."
sleep 5

# 獲取公開URL
NGROK_URL=""
for i in {1..10}; do
    NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | grep -o 'https://[^"]*\.ngrok\.io' | head -1)
    if [ -n "$NGROK_URL" ]; then
        break
    fi
    echo "⏳ 等待 ngrok 啟動... ($i/10)"
    sleep 2
done

if [ -n "$NGROK_URL" ]; then
    echo "✅ ngrok 啟動成功！"
    echo "🌍 公開URL: $NGROK_URL"
    
    # 更新.env檔案中的PUBLIC_URL
    sed -i.bak "s|PUBLIC_URL=.*|PUBLIC_URL=$NGROK_URL|" .env
    
    # 同時更新Web控制台的環境變數
    export PUBLIC_URL="$NGROK_URL"
    
    echo "📝 已更新 .env 檔案中的 PUBLIC_URL"
    echo ""
    echo "🎉 設置完成！您現在可以通過以下URL訪問："
    echo "   🌍 公開訪問: $NGROK_URL"
    echo "   📍 本地訪問: http://localhost:8888"
    echo "   📊 ngrok 控制台: http://localhost:4040"
    echo ""
    echo "📋 管理命令："
    echo "   查看 ngrok 狀態: curl http://localhost:4040/api/tunnels"
    echo "   停止 ngrok: kill \$(cat logs/ngrok.pid)"
    echo "   查看 ngrok 日誌: tail -f logs/ngrok.log"
else
    echo "❌ ngrok 啟動失敗"
    echo "📋 檢查日誌: tail -f logs/ngrok.log"
    exit 1
fi