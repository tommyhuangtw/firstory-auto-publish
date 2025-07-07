#!/bin/bash

# 本地Docker服務設置 (可選方案)

PROJECT_DIR="/Users/tommyhuang/Desktop/ai_projects/firstory-podcast-automation"
cd "$PROJECT_DIR"

echo "🐳 設置本地Docker服務..."

# 檢查Docker是否安裝
if ! command -v docker &> /dev/null; then
    echo "❌ Docker未安裝"
    echo "📦 請安裝Docker Desktop: https://www.docker.com/products/docker-desktop"
    exit 1
fi

# 檢查Docker是否運行
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker未運行，請啟動Docker Desktop"
    exit 1
fi

# 創建本地Docker Compose配置
cat > docker-compose.local.yml << 'EOF'
version: '3.8'

services:
  podcast-web-local:
    build: .
    container_name: podcast-automation-local
    restart: unless-stopped
    ports:
      - "8888:8888"
    environment:
      - NODE_ENV=development
    env_file:
      - .env
    volumes:
      # 掛載重要目錄以保持數據持久性
      - ./temp:/app/temp
      - ./logs:/app/logs
      - ./config:/app/config
      # 保持瀏覽器session
      - ./temp/browser-data:/app/temp/browser-data
    networks:
      - podcast-local
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8888/health"]
      interval: 30s
      timeout: 10s
      retries: 3

networks:
  podcast-local:
    driver: bridge
EOF

# 創建本地Dockerfile
cat > Dockerfile.local << 'EOF'
FROM node:18-alpine

# 安裝必要工具
RUN apk add --no-cache \
    chromium \
    curl \
    bash

# 設置Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# 安裝依賴
COPY package*.json ./
COPY web-console/package*.json ./web-console/
RUN npm install
WORKDIR /app/web-console
RUN npm install
WORKDIR /app

# 複製代碼
COPY . .

# 創建目錄
RUN mkdir -p temp/downloads temp/browser-data logs

EXPOSE 8888

# 啟動服務
CMD ["node", "web-console/server.js"]
EOF

echo "🏗️  建立Docker映像..."
docker build -f Dockerfile.local -t podcast-automation-local .

echo "🚀 啟動Docker容器..."
docker-compose -f docker-compose.local.yml up -d

echo "⏰ 等待服務啟動..."
sleep 10

# 檢查服務狀態
if curl -f http://localhost:8888/health > /dev/null 2>&1; then
    echo "✅ Docker服務運行正常"
    echo "📍 訪問地址: http://localhost:8888"
    echo ""
    echo "📋 Docker管理命令:"
    echo "   查看狀態: docker-compose -f docker-compose.local.yml ps"
    echo "   查看日誌: docker-compose -f docker-compose.local.yml logs -f"
    echo "   停止服務: docker-compose -f docker-compose.local.yml down"
    echo "   重啟服務: docker-compose -f docker-compose.local.yml restart"
else
    echo "❌ Docker服務啟動失敗"
    echo "📋 檢查日誌: docker-compose -f docker-compose.local.yml logs"
    exit 1
fi

echo ""
echo "🎉 本地Docker服務設置完成！"
echo "💡 優勢: 環境隔離、自動重啟、便於管理"