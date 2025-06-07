FROM node:18-slim

# 安裝系統依賴
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 設定工作目錄
WORKDIR /app

# 複製 package.json 和 package-lock.json
COPY package*.json ./

# 安裝 Node.js 依賴
RUN npm ci --only=production

# 安裝 Playwright 和瀏覽器
RUN npx playwright install chromium
RUN npx playwright install-deps chromium

# 複製應用程式碼
COPY . .

# 建立必要的目錄
RUN mkdir -p temp config

# 設定權限
RUN chmod +x start.sh

# 暴露埠號 (如果需要)
EXPOSE 3000

# 啟動命令
CMD ["npm", "start"]