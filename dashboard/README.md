# AI Podcast Dashboard

自動化 AI Podcast「AI懶人報」的內容產製平台。從 YouTube 影片抓取、AI 講稿生成、語音合成到多平台發布，全流程自動化。

取代原本 n8n + Airtable 的混合架構 — 所有核心邏輯都是 TypeScript 程式碼，可 review、可測試、可展示。

## Architecture

```
┌─────────────────────────────────┐
│     Next.js Dashboard (UI)       │
│  /episodes  /memory  /metrics    │
│  /scheduler /review              │
└──────────────┬──────────────────┘
               │
┌──────────────▼──────────────────┐
│       Next.js API Routes         │
│  /api/pipeline  /api/episodes    │
│  /api/metrics   /api/scheduler   │
└──────────────┬──────────────────┘
               │
    ┌──────────┼──────────┐
    │          │          │
┌───▼───┐ ┌───▼───┐ ┌───▼───┐
│Pipeline│ │Google │ │Sched- │
│Engine  │ │APIs   │ │uler   │
│(Lang-  │ │(Drive,│ │(node- │
│Graph)  │ │Gmail, │ │cron)  │
│9 nodes │ │YT)    │ │       │
└───┬────┘ └───────┘ └───────┘
    │
┌───▼─────────────────────────────┐
│         SQLite (single file)     │
│  episodes, tools, llm_calls,     │
│  pipeline_runs, youtube_sources  │
└─────────────────────────────────┘
```

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | Next.js 16 + React 19 + TypeScript + Tailwind 4 | Full-stack, SSR |
| Pipeline | LangGraph.js StateGraph | State observability, stage tracking |
| Database | SQLite (better-sqlite3, WAL mode) | $0, <1ms, zero deploy |
| LLM | OpenRouter (Gemini Flash/Pro) | Multi-model routing, auto cost logging |
| TTS | VoAI (台灣口音) | Production voice quality |
| Charts | Recharts | Cost & quality visualization |
| Scheduler | node-cron | Lightweight cron replacement |
| Browser Automation | Playwright | SoundOn 自動發布 |
| Logging | Pino (structured JSON) | Production-grade |

## Quick Start

```bash
# 1. 安裝 dependencies
cd dashboard
npm install

# 2. 設定環境變數
cp .env.example .env.local   # 或手動建立，見下方說明

# 3. 開發模式
npm run dev
# → http://localhost:3000

# 4. Production build
npm run build
npm start -- -p 3001
# → http://localhost:3001
```

### 系統需求

- **Node.js** 18+
- **FFmpeg** — TTS 音檔合併用（`brew install ffmpeg`）
- **Playwright browsers** — SoundOn 發布用（`npx playwright install`）

### 環境變數

建立 `dashboard/.env.local`：

```env
# === 必要 ===
OPENROUTER_API_KEY=sk-or-...        # OpenRouter LLM API key
YOUTUBE_API_KEY=AIza...              # YouTube Data API v3
APIFY_API_TOKEN=apify_api_...       # Apify YouTube 字幕擷取
VOAI_API_KEY=...                    # VoAI TTS 語音合成

# === Google OAuth（Drive/Gmail/YouTube 共用）===
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# === SoundOn 發布 ===
SOUNDON_EMAIL=...
SOUNDON_PASSWORD=...

# === 選填 ===
RECIPIENT_EMAIL=                    # Gmail 通知收件人
LOG_LEVEL=info                      # Pino log level
PLAYWRIGHT_HEADLESS=true            # Playwright headless mode
```

> Token 檔案存放在 `../temp/`（google-tokens.json, youtube-tokens.json）。

## 頁面導覽

| 路徑 | 說明 |
|------|------|
| `/` | Dashboard 首頁 — DB 狀態、最近 episodes |
| `/episodes` | Episodes 列表 + 建立新集數（含即時 pipeline 進度追蹤） |
| `/episodes/:id/review` | 審核頁 — 試聽、封面預覽、選標題、編輯描述、approve/reject |
| `/memory` | 工具記憶 — AI 工具跨集追蹤（category filter, search） |
| `/memory/:name` | 工具詳情 — mentions、evolving summary、episode timeline |
| `/metrics` | LLM Metrics — 成本圖表、品質趨勢、stage breakdown |
| `/scheduler` | 排程管理 — cron job 狀態 & 手動觸發 |

## Pipeline 流程（9 Stages）

```
START → fetchYoutube → classify → scriptEnglish → extractTools → translate
      → enrichMemory → scoreQuality → generateMeta → synthesizeTts → END
```

| Node | Model | 說明 |
|------|-------|------|
| **fetchYoutube** | YouTube Data API + Apify | 搜尋影片 + 擷取字幕，去重篩選 top 5 |
| **classify** | Gemini Flash Lite | 分類 `is_tool` / `is_robotics`（parallel） |
| **scriptEnglish** | Gemini Pro | 生成 5000-6000 字英文講稿 |
| **extractTools** | Gemini Flash Lite | 從講稿擷取 AI 工具，存入記憶系統 |
| **translate** | Gemini Pro | 翻譯為台灣繁體中文口語，保留英文工具名 |
| **enrichMemory** | Gemini Flash Lite | 注入跨集回顧語句（「我們在第 X 集也聊過...」） |
| **scoreQuality** | Gemini Flash | 4 維度評分，< 85 分自動 refine（最多 2 次） |
| **generateMeta** | Gemini Flash | 10 個標題候選 → 描述 → YouTube tags |
| **synthesizeTts** | VoAI | 300 字 chunk → batch-5 合成 → FFmpeg concat |

Pipeline 完成後 episode 進入 `pending_review`，人工審核通過後自動發布到 SoundOn + YouTube。

啟動 pipeline 後，UI 會即時顯示 9 階段進度（每 2 秒 polling），失敗時顯示 error log。

## 內容類型

| Segment Type | 名稱 | 說明 |
|--------------|------|------|
| `daily` | AI懶人報 | 每日 AI 工具與新聞精選 |
| `weekly` | AI精選週報 | 一週 AI 重點整理 |
| `robot` | 機器人週報 | 機器人與自動化新聞 |

## API Endpoints

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/health` | 健康檢查（DB + table count） |
| GET | `/api/episodes` | 列出 episodes（支援 status/segment filter） |
| POST | `/api/pipeline/start` | 啟動 pipeline（非同步，立即回傳 runId） |
| GET | `/api/pipeline/status` | 最近 10 筆 pipeline runs |
| GET | `/api/pipeline/status/:id` | 單筆 pipeline run 狀態（用於 polling） |
| POST | `/api/episodes/:id/approve` | 審核通過 + 觸發發布 |
| POST | `/api/episodes/:id/reject` | 拒絕 episode |
| GET | `/api/episodes/:id/status` | Episode 狀態 + publish URLs |
| GET | `/api/metrics` | LLM 成本 & 品質數據 |
| GET | `/api/scheduler/status` | 排程任務狀態 |
| POST | `/api/scheduler/trigger` | 手動觸發排程（body: `{ name }`） |
| GET | `/api/audio/[...path]` | 音檔串流（支援 HTTP Range） |

### 範例

```bash
# 啟動 pipeline
curl -X POST http://localhost:3001/api/pipeline/start \
  -H 'Content-Type: application/json' \
  -d '{"episodeNumber": 300, "segmentType": "daily"}'

# 查詢 pipeline 進度
curl http://localhost:3001/api/pipeline/status/1

# 審核通過
curl -X POST http://localhost:3001/api/episodes/300/approve \
  -H 'Content-Type: application/json' \
  -d '{"selectedTitle": "Custom Title"}'
```

## Database Schema

SQLite 檔案：`dashboard/data/podcast.db`（啟動時自動建表）

| Table | 用途 |
|-------|------|
| `episodes` | 集數內容（講稿、標題、音檔、封面、發布 URL） |
| `tools` | AI 工具知識庫（canonical name, aliases, category） |
| `episode_tool_mentions` | 工具 × 集數關聯（mention_type, context_snippet） |
| `llm_calls` | LLM 呼叫記錄（model, tokens, cost, latency, quality） |
| `pipeline_runs` | Pipeline 執行歷史（status, current_stage, error_log） |
| `youtube_sources` | YouTube 來源影片快取 |
| `platform_analytics` | 各平台成效數據 |

Schema DDL：`dashboard/src/db/schema.sql`

## LLM Cost Tracking

每次 LLM 呼叫自動記錄到 `llm_calls` table，可在 `/metrics` 頁面查看圖表。

Model 選擇策略：
- **Classification / Tool Extraction**: Gemini Flash Lite — 便宜（~$0.001/call）
- **Script / Translation**: Gemini Pro — 創意品質重要（~$0.05/call）
- **Scoring / Meta**: Gemini Flash — 結構化輸出，速度優先（~$0.01/call）

## Project Structure

```
dashboard/
├── src/
│   ├── app/
│   │   ├── page.tsx                        # Dashboard 首頁
│   │   ├── episodes/
│   │   │   ├── page.tsx                    # Episodes 列表
│   │   │   ├── NewEpisodeForm.tsx           # 新增集數 + pipeline 進度追蹤
│   │   │   └── [id]/review/
│   │   │       ├── page.tsx                # 審核頁
│   │   │       └── ReviewClient.tsx        # 互動元件（approve/reject）
│   │   ├── memory/
│   │   │   ├── page.tsx                    # 工具列表
│   │   │   └── [name]/page.tsx             # 工具詳情
│   │   ├── metrics/
│   │   │   ├── page.tsx                    # Metrics 頁面
│   │   │   └── MetricsClient.tsx           # Recharts 圖表
│   │   ├── scheduler/
│   │   │   ├── page.tsx                    # 排程管理
│   │   │   └── SchedulerClient.tsx         # 排程互動元件
│   │   └── api/                            # API routes（見上方表格）
│   ├── components/
│   │   └── Navigation.tsx                  # Sidebar + mobile bottom bar
│   ├── db/
│   │   ├── index.ts                        # SQLite connection（WAL, auto-migrate）
│   │   └── schema.sql                      # 7 tables DDL
│   ├── lib/
│   │   ├── googleAuth.ts                   # Shared OAuth2
│   │   └── logger.ts                       # Pino structured logging
│   └── services/
│       ├── llmService.ts                   # OpenRouter + auto cost logging
│       ├── googleDrive.ts                  # Drive upload/download
│       ├── gmail.ts                        # 通知信
│       ├── youtube.ts                      # 影片上傳
│       ├── soundon.ts                      # SoundOn Playwright 自動發布
│       ├── videoCreator.ts                 # FFmpeg audio + image → MP4
│       ├── scheduler.ts                    # node-cron job manager
│       ├── memory/
│       │   ├── toolExtractor.ts            # LLM 工具擷取
│       │   └── memoryService.ts            # 工具記憶 DB 操作
│       └── pipeline/
│           ├── state.ts                    # PipelineState type
│           ├── graph.ts                    # LangGraph StateGraph + startPipeline()
│           └── nodes/                      # 9 pipeline nodes
└── data/
    └── podcast.db                          # SQLite（auto-created）
```

## Development Status

- [x] Phase 1: Foundation（SQLite, services, API routes）
- [x] Phase 2: LangGraph content pipeline（9 nodes）
- [x] Phase 3: Review UI + Publisher（SoundOn Playwright, YouTube API）
- [x] Phase 4: Memory system（tool extraction, cross-episode references）
- [x] Phase 5: Evaluation dashboard（Recharts cost/quality charts）
- [x] UI 補強（pipeline 進度追蹤、錯誤顯示、scheduler UI、封面預覽）
- [ ] Phase 6: Production deploy（Docker, AWS Lightsail）
