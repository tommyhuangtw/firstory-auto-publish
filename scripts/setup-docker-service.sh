#!/bin/bash

# 設置Docker 24/7服務

set -e

PROJECT_DIR="/Users/tommyhuang/Desktop/ai_projects/firstory-podcast-automation"
cd "$PROJECT_DIR"

echo "🐳 設置Docker 24/7 Podcast自動化服務..."

# 檢查Docker是否運行
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker未運行，請啟動Docker Desktop"
    exit 1
fi

# 檢查是否有ngrok authtoken
if [ -z "$NGROK_AUTHTOKEN" ]; then
    echo "🔑 請設置NGROK_AUTHTOKEN環境變數"
    echo "   1. 前往 https://dashboard.ngrok.com/auth"
    echo "   2. 複製您的authtoken"
    echo "   3. 執行: export NGROK_AUTHTOKEN=your_token"
    echo ""
    read -p "請輸入您的 ngrok authtoken: " TOKEN
    
    if [ -n "$TOKEN" ]; then
        export NGROK_AUTHTOKEN="$TOKEN"
        echo "export NGROK_AUTHTOKEN=\"$TOKEN\"" >> ~/.bashrc
        echo "export NGROK_AUTHTOKEN=\"$TOKEN\"" >> ~/.zshrc
        echo "✅ ngrok authtoken 已設置並保存到shell配置"
    else
        echo "❌ 需要ngrok authtoken才能繼續"
        exit 1
    fi
fi

# 停止現有的直接運行服務
echo "🛑 停止現有的直接運行服務..."
./scripts/stop-local-service.sh || true

# 停止現有Docker容器
echo "🛑 停止現有Docker容器..."
docker-compose -f docker-compose.local.yml down || true

# 建立Docker映像
echo "🏗️ 建立Docker映像..."
docker build -f Dockerfile.local -t podcast-automation-local .

# 啟動Docker服務
echo "🚀 啟動Docker服務..."
docker-compose -f docker-compose.local.yml up -d

echo "⏰ 等待服務啟動..."
sleep 15

# 檢查服務狀態
echo "🔍 檢查服務狀態..."
docker-compose -f docker-compose.local.yml ps

# 健康檢查
if curl -f http://localhost:8888/health > /dev/null 2>&1; then
    echo "✅ Docker服務運行正常"
    
    # 檢查ngrok連接 (可能需要時間)
    echo "⏰ 等待ngrok建立連接..."
    sleep 10
    
    # 嘗試獲取ngrok URL
    NGROK_URL=""
    for i in {1..6}; do
        NGROK_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o 'https://[^"]*\.ngrok.*\.app' | head -1)
        if [ -n "$NGROK_URL" ]; then
            break
        fi
        echo "⏳ 等待ngrok連接... ($i/6)"
        sleep 5
    done
    
    if [ -n "$NGROK_URL" ]; then
        echo "🌍 ngrok URL: $NGROK_URL"
        
        # 更新.env檔案
        sed -i.bak "s|PUBLIC_URL=.*|PUBLIC_URL=$NGROK_URL|" .env
        
        echo "📝 已更新 .env 檔案"
        echo ""
        echo "🎉 Docker服務設置完成！"
        echo ""
        echo "📍 訪問地址:"
        echo "   🌐 公網訪問: $NGROK_URL"
        echo "   📍 本地訪問: http://localhost:8888"
        echo "   📊 ngrok控制台: http://localhost:4040"
        echo ""
        echo "💡 特色："
        echo "   ✅ 24/7不間斷運行"
        echo "   ✅ 電腦休眠也能訪問"
        echo "   ✅ 自動重啟"
        echo "   ✅ 保持SoundOn登入狀態"
    else
        echo "⚠️  ngrok連接可能需要更多時間，請稍後檢查"
        echo "📋 檢查ngrok狀態: curl http://localhost:4040/api/tunnels"
    fi
    
else
    echo "❌ Docker服務啟動失敗"
    echo "📋 檢查日誌: docker-compose -f docker-compose.local.yml logs"
    exit 1
fi

echo ""
echo "📋 Docker管理命令:"
echo "   查看狀態: docker-compose -f docker-compose.local.yml ps"
echo "   查看日誌: docker-compose -f docker-compose.local.yml logs -f"
echo "   重啟服務: docker-compose -f docker-compose.local.yml restart"
echo "   停止服務: docker-compose -f docker-compose.local.yml down"
echo "   更新服務: docker-compose -f docker-compose.local.yml build --no-cache && docker-compose -f docker-compose.local.yml up -d"

echo ""
echo "🎉 現在你的Podcast自動化服務已經在Docker中24/7運行！"
echo "💤 即使電腦休眠，你也能從任何地方訪問和觸發上傳。"