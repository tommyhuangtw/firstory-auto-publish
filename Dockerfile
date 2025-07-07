# 使用官方Node.js 18映像
FROM node:18-alpine

# 安裝系統依賴（Playwright需要）
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    curl \
    bash

# 設置Chromium執行檔路徑
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# 設置工作目錄
WORKDIR /app

# 複製package文件
COPY package*.json ./
COPY web-console/package*.json ./web-console/

# 安裝主項目依賴
RUN npm install

# 安裝Web控制台依賴
WORKDIR /app/web-console
RUN npm install

# 回到主目錄
WORKDIR /app

# 複製所有項目文件
COPY . .

# 創建必要目錄
RUN mkdir -p temp/downloads temp/browser-data logs

# 設置權限
RUN addgroup -g 1001 -S nodejs && \
    adduser -S podcastuser -u 1001 -G nodejs && \
    chown -R podcastuser:nodejs /app

# 切換到非root用戶
USER podcastuser

# 暴露端口
EXPOSE 8888

# 健康檢查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8888/health || exit 1

# 啟動Web控制台
CMD ["node", "web-console/server.js"]