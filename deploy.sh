#!/bin/bash

set -e  # 遇到錯誤立即停止

echo "🚀 開始部署 Podcast 自動化系統到 Hostinger VPS..."

# 檢查必要文件
if [ ! -f ".env" ]; then
    echo "❌ 找不到 .env 檔案，請先設置環境變數"
    exit 1
fi

# VPS 配置
VPS_HOST="147.93.81.69"
VPS_USER="root"
VPS_PATH="/opt/podcast-automation"

echo "📦 準備部署檔案..."

# 創建部署檔案清單
cat > deploy-files.txt << EOF
.env
Dockerfile
docker-compose.yml
nginx.conf
.dockerignore
package.json
web-console/
src/
interactive-soundon-flow.js
temp/google-tokens.json
temp/gmail-tokens.json
config/
EOF

echo "📤 上傳檔案到 VPS..."

# 使用 rsync 同步檔案
rsync -avz --progress \
    --include-from=deploy-files.txt \
    --exclude='*' \
    ./ ${VPS_USER}@${VPS_HOST}:${VPS_PATH}/

echo "🔧 在 VPS 上部署..."

# 在 VPS 上執行部署命令
ssh ${VPS_USER}@${VPS_HOST} << EOF
    set -e
    cd ${VPS_PATH}
    
    echo "🛑 停止現有容器..."
    docker-compose down || true
    
    echo "🏗️ 建立新的 Docker 映像..."
    docker-compose build --no-cache
    
    echo "🚀 啟動服務..."
    docker-compose up -d
    
    echo "⏰ 等待服務啟動..."
    sleep 30
    
    echo "🔍 檢查服務狀態..."
    docker-compose ps
    
    echo "🏥 健康檢查..."
    if curl -f http://localhost:8888/health; then
        echo "✅ 服務運行正常！"
    else
        echo "❌ 服務啟動失敗"
        docker-compose logs
        exit 1
    fi
    
    echo "📊 顯示日誌..."
    docker-compose logs --tail=20
EOF

echo "🎉 部署完成！"
echo ""
echo "📍 訪問地址:"
echo "  🌐 直接訪問: http://${VPS_HOST}:8888"
echo "  🔄 代理訪問: http://${VPS_HOST}:4000"
echo ""
echo "📋 管理命令:"
echo "  查看狀態: ssh ${VPS_USER}@${VPS_HOST} 'cd ${VPS_PATH} && docker-compose ps'"
echo "  查看日誌: ssh ${VPS_USER}@${VPS_HOST} 'cd ${VPS_PATH} && docker-compose logs -f'"
echo "  重啟服務: ssh ${VPS_USER}@${VPS_HOST} 'cd ${VPS_PATH} && docker-compose restart'"
echo "  停止服務: ssh ${VPS_USER}@${VPS_HOST} 'cd ${VPS_PATH} && docker-compose down'"

# 清理臨時檔案
rm -f deploy-files.txt

echo "🔧 部署完成！請訪問 Web 控制台測試功能。"