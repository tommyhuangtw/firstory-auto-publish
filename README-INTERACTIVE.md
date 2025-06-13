# 🎙️ AI懶人報 - 互動式 SoundOn 自動上傳系統

## 📋 功能概述

這是一個全自動的播客上傳系統，具備以下特色功能：

### ✨ 核心功能
- 🤖 **AI 標題生成**：從 Airtable 自動生成多個候選標題
- 📧 **Gmail 互動選擇**：通過精美的郵件界面選擇最佳標題
- 🔢 **自動集數編號**：智能分析現有單集，自動添加 EP 編號
- 📁 **Google Drive 整合**：自動下載最新音檔和封面圖片
- 🚀 **一鍵上傳**：選擇標題後自動完成 SoundOn 上傳流程

### 🎯 工作流程

```
1. 初始化服務 (Google Drive, Gmail, SoundOn)
2. 分析現有單集，判斷下一集編號
3. 從 Airtable 生成候選標題
4. 為標題添加集數編號 (EP11, EP12...)
5. 發送 Gmail 確認郵件
6. 等待用戶選擇標題
7. 下載 Google Drive 檔案
8. 自動上傳到 SoundOn
```

## 🚀 使用方法

### 基本執行
```bash
node interactive-soundon-flow.js
```

### 測試模式
```bash
node test-interactive-flow.js
```

## 📧 郵件界面特色

- 🎨 **現代化設計**：漸層背景、卡片式佈局
- 📱 **響應式設計**：支援手機和桌面瀏覽
- 🔤 **UTF-8 編碼**：完美支援中文顯示
- ⚡ **互動效果**：按鈕懸停動畫
- 📊 **統計資訊**：顯示候選標題數量
- ⚠️ **重要提醒**：醒目的注意事項

## 🔧 技術特點

### 集數自動編號
- 智能解析 SoundOn 現有單集列表
- 使用多種 CSS 選擇器確保相容性
- 正則表達式提取 EP 編號
- 自動計算下一集編號

### 錯誤處理
- 完善的異常捕獲機制
- 優雅的降級處理
- 詳細的日誌輸出
- 自動清理臨時文件

### 服務整合
- Google Drive API 檔案下載
- Gmail API 郵件發送
- Airtable API 內容生成
- Express.js 本地服務器

## 📁 檔案結構

```
├── interactive-soundon-flow.js     # 主流程文件
├── test-interactive-flow.js        # 測試文件
├── src/services/
│   ├── gmail.js                   # Gmail 服務
│   ├── titleSelectionServer.js    # 標題選擇服務器
│   ├── googleDrive.js            # Google Drive 服務
│   └── airtable.js               # Airtable 服務
└── README-INTERACTIVE.md          # 本說明文件
```

## 🎨 郵件模板特色

### 視覺設計
- 漸層背景 (#667eea → #764ba2)
- 白色半透明主卡片
- 高對比度文字 (#1e293b)
- 黃色警告區塊 (#fef3c7)

### 互動元素
- 懸停效果按鈕
- 自動關閉確認頁面
- 響應式佈局
- 統計數據展示

## 🔍 故障排除

### 常見問題

1. **集數解析失敗**
   - 檢查 SoundOn 頁面結構是否變更
   - 確認網路連線穩定
   - 查看控制台錯誤訊息

2. **郵件編碼問題**
   - 已使用 UTF-8 Base64 編碼
   - 確認 Gmail API 權限正確

3. **檔案下載失敗**
   - 檢查 Google Drive 權限
   - 確認檔案存在且可存取

## 📊 系統需求

- Node.js 14+
- 有效的 Google API 憑證
- SoundOn 帳號權限
- Airtable API 存取權

## 🎯 未來改進

- [ ] 支援批次上傳
- [ ] 添加預覽功能
- [ ] 整合更多播客平台
- [ ] 增加排程功能
- [ ] 優化錯誤恢復機制

---

💡 **提示**：首次使用前請確保所有 API 憑證已正確設定，並完成 Google 服務認證。 