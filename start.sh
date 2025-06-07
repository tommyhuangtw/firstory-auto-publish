#!/bin/bash

# Firstory Podcast 自動上傳系統啟動腳本

echo "🎙️  啟動 Firstory Podcast 自動上傳系統..."

# 檢查 Node.js 是否安裝
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安裝，請先安裝 Node.js"
    exit 1
fi

# 檢查 .env 檔案是否存在
if [ ! -f .env ]; then
    echo "❌ .env 檔案不存在，請複製 .env.example 並設定環境變數"
    exit 1
fi

# 檢查 Google 憑證檔案
if [ ! -f config/google-credentials.json ]; then
    echo "❌ Google 憑證檔案不存在，請設定 config/google-credentials.json"
    exit 1
fi

# 安裝依賴套件
echo "📦 安裝依賴套件..."
npm install

# 安裝 Playwright 瀏覽器
echo "🌐 安裝 Playwright 瀏覽器..."
npx playwright install chromium

# 啟動系統
echo "🚀 啟動自動上傳系統..."
npm start