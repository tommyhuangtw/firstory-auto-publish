# Dev vs Production 部署指南

## 現況問題

目前 Dashboard 是用 `next dev` 跑在 `localhost:3000`，再透過 Cloudflare Tunnel 對外公開到 `hub.ailanbao.org`。這導致：

- **效能差**：`next dev` 每個 request 都即時編譯，首次載入慢 2-5 秒
- **不穩定**：dev server 會因 HMR、記憶體洩漏等原因自己掛掉
- **code 不一致**：改了 code 但忘了重啟 server → 外面看到舊版本（剛剛遇到的問題）
- **資源浪費**：Turbopack 持續 watch 檔案、佔用 CPU 和記憶體

## Dev vs Production 差異

| | `npm run dev` | `npm run build` + `npm run start` |
|---|---|---|
| 指令 | `next dev` | `next build && next start` |
| 編譯時機 | 每次 request 即時編譯 | 一次性全部編譯完 |
| 速度 | 慢（首頁 ~2-5s） | 快（首頁 ~100-300ms） |
| HMR | 有（改 code 自動刷新） | 無 |
| 用途 | 本地開發、寫 code | 對外服務、production |
| 穩定性 | 不穩定 | 穩定 |
| 錯誤訊息 | 詳細的 stack trace | 簡潔的 error page |
| Source Maps | 完整 | 預設不含 |

## 建議架構

```
開發時（寫 code）：
  npm run dev          → localhost:3001（或其他 port）
  瀏覽器直接開 localhost:3001

Production（對外服務）：
  npm run build        → 編譯到 .next/
  npm run start        → localhost:3000
  Cloudflare Tunnel    → hub.ailanbao.org
```

## 設定步驟

### 1. 建立 production 啟動腳本

```bash
# dashboard/scripts/start-prod.sh
#!/bin/bash
cd "$(dirname "$0")/.."
npm run build && npm run start -- --port 3000
```

```bash
chmod +x dashboard/scripts/start-prod.sh
```

### 2. 建立 launchd service（開機自動啟動）

建立 `~/Library/LaunchAgents/com.podcast.dashboard.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.podcast.dashboard</string>

  <key>WorkingDirectory</key>
  <string>/Users/tommyhuang/Desktop/ai_projects/firstory-podcast-automation/dashboard</string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>node_modules/.bin/next</string>
    <string>start</string>
    <string>--port</string>
    <string>3000</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>/tmp/podcast-dashboard.log</string>

  <key>StandardErrorPath</key>
  <string>/tmp/podcast-dashboard.error.log</string>
</dict>
</plist>
```

安裝：

```bash
cp ~/Library/LaunchAgents/com.podcast.dashboard.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.podcast.dashboard.plist
```

### 3. 部署流程（改完 code 後）

```bash
cd dashboard

# 1. 編譯
npm run build

# 2. 重啟 production server
launchctl kickstart -k gui/$(id -u)/com.podcast.dashboard

# 3. 確認
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
# 應該回 200
```

### 4. 開發時用不同 port

```bash
# 開發用 3001，不影響 production
npm run dev -- --port 3001
```

## 日常操作

| 情境 | 指令 |
|------|------|
| 寫 code + 即時預覽 | `npm run dev -- --port 3001` |
| 部署新版本 | `npm run build && launchctl kickstart -k gui/$(id -u)/com.podcast.dashboard` |
| 看 production log | `tail -f /tmp/podcast-dashboard.log` |
| 看錯誤 log | `tail -f /tmp/podcast-dashboard.error.log` |
| 手動啟動 production | `npm run build && npm run start -- --port 3000` |
| 停止 production | `launchctl stop com.podcast.dashboard` |

## Agent 系統注意事項

小工（Engineer Agent）在 feature branch 上開發時，只跑 `npm run build` 驗證編譯。
不需要重啟 production server — 等 Tommy approve + merge 到 main 後再部署。

部署 checklist：
1. `git checkout main && git pull`
2. `cd dashboard && npm run build`
3. `launchctl kickstart -k gui/$(id -u)/com.podcast.dashboard`
4. 手機開 `hub.ailanbao.org` 確認
