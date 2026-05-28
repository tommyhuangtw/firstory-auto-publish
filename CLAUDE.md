# CLAUDE.md

## Project Overview

**AI 懶人報 Podcast Automation** — 全自動 Podcast 產製系統。從 YouTube 影片搜尋、AI 腳本生成、TTS 語音合成、到多平台發布（SoundOn / YouTube / Instagram / Facebook / Threads），全流程自動化，僅在發布前需人工審核。

- **Tech Stack**: Next.js 14 + TypeScript + LangGraph + SQLite
- **Dashboard**: `dashboard/` (主要開發目錄)
- **Database**: SQLite (`dashboard/data/podcast.db`, WAL mode)
- **Hermes Agent**: `hermes/` (AI 營運助手，透過 Telegram 操控系統)
- **Legacy code**: `src/`, `web-console/` 保留至遷移完成

---

## Coding Guidelines

### 開發原則 (Karpathy Skills)
1. **Think Before Coding** — 不假設、不隱藏困惑、明確列出 assumptions。多種做法時先呈現選項，不要默默選一個。
2. **Simplicity First** — 最少程式碼解決問題。不加未要求的功能、不為單次使用建 abstraction、不處理不可能的 error scenarios。
3. **Surgical Changes** — 只改必要的部分。不「順便改善」旁邊的 code/comments/formatting。只清理自己造成的 orphans。
4. **Goal-Driven Execution** — 把模糊需求轉成可驗證的 success criteria，loop 直到驗證通過。

### 開發完成前必須驗證（自己測、不要問）
- 每次開發完成後，**必須自己跑完整測試**，確認沒問題才能呈現給使用者
- 這是資深工程師的基本素養 — **不要問使用者要不要測試，直接測**
- 最低驗證標準：`cd dashboard && npm run build` 編譯通過
- 有改動 pipeline/service 邏輯時，用 `scripts/` 下的測試腳本跑一次 smoke test
- 新增 agent/script 時，必須跑 import 驗證 + 實際功能 smoke test
- 不要只說「應該沒問題」— 要實際執行、看到結果、確認正確
- 不要只驗證 build — 要跑實際 use case 驗證功能是否正常運作

### Task Board Ticket 流程
- Task Board 狀態流程：`todo` → `in_progress` → `review` → `done`（另有 `blocked`、`cancelled`）
- 開發完成要讓使用者 review 時，**必須把 ticket 狀態改為 `review`**（不是 `done`）
- **移到 `review` 之前，agent 必須先完成測試**，不能跳過
- 在 ticket 的 comments 中**必須附上測試證明**（使用 `test` type tag）：
  - Build log（`npm run build` 輸出）
  - API request/response log
  - 相關的測試執行結果
- 有截圖或 API request/response 的話優先附上
- 所有 comments 都會顯示完整日期+時間戳（YYYY/MM/DD HH:mm:ss）
- Comment authors：`tommy`（人工）、`hermes`（Hermes Agent）、`claude-code`（auto-task-executor）
- `hermes` 和 `claude-code` 在 UI 上都顯示為「懶懶」

### Git Commit 偏好
- **不要**在 commit message 中加入 `Co-Authored-By` 行
- Commit message 一律使用**英文**撰寫

---

## System Architecture

### Content Pipeline (LangGraph)

13-stage linear state machine，每個 node 存 snapshot 到 DB 供 retry：

```
fetchYoutube → classify → scriptEnglish → extractTools → translate
→ customContentInsert → scoreQuality → generateMeta → generateCover
→ synthesizeTts → generateSubtitles → uploadAssets → notify → END
                                                          ↓
                                               [暫停：人工審核]
                                                          ↓
                                                    publish (approve 後觸發)
```

**Pipeline nodes**: `dashboard/src/services/pipeline/nodes/`
**Pipeline state**: `dashboard/src/services/pipeline/state.ts`
**Graph definition**: `dashboard/src/services/pipeline/graph.ts`

### Segment Types

| Type | 說明 | YouTube Source Table |
|------|------|---------------------|
| `daily` | 每日 AI 工具精選 | `youtube_sources` |
| `weekly` | 每週 AI 精選週報 | `weekly_youtube_sources` |
| `robot` | 機器人觀察週報 | `robot_youtube_sources` |
| `sysdesign` | 系統設計懶懶學 | 支援 `manual_video_urls` |

### Publishing Flow

Publish 時，每個平台獨立執行，一個失敗不影響其他：

1. **SoundOn** — Playwright 自動化登入 → 上傳音檔 → 填 metadata → 發布
2. **YouTube** — 生成 composite 雙面板圖（左標題+右封面）→ FFmpeg 燒錄字幕到 MP4 → 上傳影片 + 縮圖 + SRT closed captions
3. **Instagram** — 封面圖上傳 Cloudinary → Graph API 發布
4. **Facebook** — 封面圖 + LLM 生成貼文 → Graph API 發布
5. **Threads** — LLM 生成貼文 → Threads API 發布

### Video Creation

- **影片畫面**: 永遠使用 composite 雙面板佈局（`thumbnailGenerator.ts` 生成：左面板=EP+標題，右面板=IG 封面圖）
- **字幕**: FFmpeg `subtitles` filter 燒錄 SRT（白字+半透明黑底，10fps）
- **YouTube 縮圖**: User-selected 或 composite，獨立於影片畫面
- **SRT**: 同時上傳到 YouTube 作為 closed captions（SEO 用）

---

## Hermes Agent Integration

Hermes Agent（Nous Research）作為 AI 營運助手，透過 Telegram 接收通知、遠端操控 pipeline、自主研究 AI 趨勢。

### Architecture

```
┌─────────────────┐         ┌──────────────┐         ┌──────────────────┐
│  Hermes Agent   │  stdio  │  MCP Server  │  HTTP   │  Next.js App     │
│  + Telegram GW  │◄───────►│  podcast-mcp │────────►│  localhost:3000   │
│  + Cron jobs    │         └──────────────┘         └────────┬─────────┘
│  + Webhook :8644│◄─────────────────────────────────────────┘
└─────────────────┘         notificationHub POST

```

### Components

| Component | Path | 用途 |
|-----------|------|------|
| MCP Server | `hermes/podcast-mcp/` | ~40 tools 操控 pipeline/episodes/scheduler/analytics/n8n/git |
| Webhook Receiver | Built-in Hermes (port 8644) | 接收 pipeline 事件推送到 Telegram |
| NotificationHub | `dashboard/src/services/notificationHub.ts` | 中央事件派發（pipeline 完成/失敗/待審核/已發布） |
| Context Files | `hermes/context/` | 系統架構、操作手冊、品牌語調、n8n pipeline 說明 |
| Config Reference | `hermes/config/hermes-config.yaml` | MCP + context + cron 設定參考 |

### MCP Tools (~40 tools)

| Group | Tools | 用途 |
|-------|-------|------|
| Pipeline | 5 | 啟動/監控/重試 pipeline |
| Episodes | 12 | 列表/審核/approve/reject/regenerate |
| Scheduler | 5 | 排程管理 |
| Analytics | 4 | 成本/品質/平台數據 |
| YouTube | 3 | 搜尋來源管理 |
| Media | 3 | 縮圖操作 |
| Settings | 2 | 系統設定 |
| n8n | 3 | 觸發 Threads 策展 workflow |
| Git | 5 | 建 hermes/* branch、查 diff（不能 merge） |

### Cron Jobs

| Job | Schedule | 用途 |
|-----|----------|------|
| `morning_content_curation` | 每天 8:00 | 觸發 n8n + AI 趨勢研究 + episode 主題建議 |
| `evening_operations_review` | 每天 20:00 | Pipeline 狀態 + 成本 + 改善建議 |

### Notification Events

Pipeline 事件透過 `notificationHub` → Hermes webhook → Telegram 推送：
- `pipeline.completed` / `pipeline.failed`
- `pipeline.retry.success` / `pipeline.retry.failed`
- `episode.ready_for_review` / `episode.published` / `episode.publish.partial_failure`

### Hermes Safety Rules

- 只能在 `hermes/*` prefix 的 branch 上工作
- 不能直接 push 到 main 或 merge
- 每次改動必須通過 `npm run build`
- 改動超過 5 個檔案時需先確認方向

---

## Key Services

| Service | File | 用途 |
|---------|------|------|
| `llmService` | `services/llmService.ts` | OpenRouter LLM API（Gemini/Claude/GPT），自動記錄 cost & tokens |
| `youtube` | `services/youtube.ts` | YouTube Data API v3：搜尋、上傳、縮圖、字幕 |
| `soundon` | `services/soundon.ts` | SoundOn Playwright 自動化上傳 |
| `videoCreator` | `services/videoCreator.ts` | FFmpeg 影片生成（支援字幕燒錄） |
| `subtitleGenerator` | `services/subtitleGenerator.ts` | Whisper 轉錄 + 腳本對齊 + SRT 生成 |
| `thumbnailGenerator` | `services/thumbnailGenerator.ts` | Playwright 渲染 HTML → 1280x720 JPEG |
| `kieai` | `services/kieai.ts` | kie.ai 圖片生成（GPT Image 2） |
| `cloudinary` | `services/cloudinary.ts` | CDN 圖片上傳 |
| `instagram` | `services/instagram.ts` | Instagram Graph API 發布 |
| `facebook` | `services/facebook.ts` | Facebook Graph API 發布 |
| `threads` | `services/threads.ts` | Threads API 發布 |
| `gmail` | `services/gmail.ts` | Gmail 通知信（標題確認、縮圖選擇） |
| `googleDrive` | `services/googleDrive.ts` | Drive 上傳音檔/圖片 |
| `descriptionAssembler` | `services/descriptionAssembler.ts` | 組裝 episode 描述（業配+本文+footer） |
| `scheduler` | `services/scheduler.ts` | node-cron 排程管理 |
| `memory/*` | `services/memory/` | AI 工具記憶系統（擷取、分類、回顧語句注入） |
| `shortsPipeline` | `services/shortsPipeline.ts` | Shorts 生成（beat 選擇、headline、影片組裝） |
| `notificationHub` | `services/notificationHub.ts` | 中央事件派發（Gmail + Hermes webhook） |
| `knowledgeService` | `services/knowledgeService.ts` | Knowledge Base：研究文件索引、自動同步、分類、搜尋 |

---

## External APIs & Environment Variables

### 必要
| Variable | Service |
|----------|---------|
| `OPENROUTER_API_KEY` | LLM（Gemini/Claude/GPT via OpenRouter） |
| `OPENAI_API_KEY` | Whisper 語音轉錄 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | YouTube/Gmail/Drive OAuth |
| `YOUTUBE_API_KEY` or `YOUTUBE_API_KEYS` | YouTube Data API |
| `VOAI_API_KEY` | VoAI TTS 語音合成 |
| `KIE_AI_API_KEY` | kie.ai 圖片生成 |
| `APIFY_API_TOKEN` | YouTube 字幕擷取 |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET` | 圖片 CDN |
| `SOUNDON_EMAIL`, `SOUNDON_PASSWORD` | SoundOn 發布 |

### 社群媒體（選用）
| Variable | Service |
|----------|---------|
| `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_ACCOUNT_ID` | IG 發布 |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | FB OAuth + 發布 |
| `THREADS_APP_ID`, `THREADS_APP_SECRET` | Threads OAuth + 發布 |

### 其他
| Variable | Service |
|----------|---------|
| `RECIPIENT_EMAIL` | 通知信收件人 |
| `GDRIVE_PODCAST_FOLDER`, `GDRIVE_IMAGE_FOLDER` | Drive 上傳目標 |
| `GOOGLE_DOCS_CUSTOM_CONTENT_ID` | 自訂內容 Google Doc ID |
| `HERMES_WEBHOOK_URL` | Hermes Agent webhook endpoint（pipeline 事件推送） |

---

## Database Schema (20 tables)

**Core**: `episodes`, `pipeline_runs`, `pipeline_snapshots`, `llm_calls`, `service_costs`
**Content Sources**: `youtube_sources`, `weekly_youtube_sources`, `robot_youtube_sources`
**Memory**: `tools`, `tool_families`, `episode_tool_mentions`
**Publishing**: `shorts`, `sponsor_audio_presets`, `ad_presets`
**Analytics**: `platform_analytics`, `soundon_daily_downloads`, `soundon_episodes`
**Tasks**: `tasks`, `task_comments`
**Knowledge**: `knowledge_docs`
**Config**: `settings`

Schema 定義: `dashboard/src/db/schema.sql`
Migration: `dashboard/src/db/index.ts`（`safeAlter` 自動加 column）

---

## UI Pages (16 pages)

| Path | 用途 |
|------|------|
| `/` | Dashboard 首頁（DB 狀態、episode 數、pipeline runs） |
| `/episodes` | Episode 列表（status badges、quality scores、cost） |
| `/episodes/[id]/review` | 審核頁（audio player、標題選擇、描述編輯、approve/reject） |
| `/scheduler` | 排程管理（job 列表、手動觸發、skip） |
| `/metrics` | 成本 & 品質指標（Recharts 圖表） |
| `/analytics` | 平台數據（downloads、listens、engagement） |
| `/memory` | AI 工具記憶瀏覽（分類、搜尋） |
| `/memory/[name]` | 單一工具詳情（出現次數、演化摘要） |
| `/knowledge` | Knowledge Base（研究文件瀏覽、搜尋、分類篩選） |
| `/knowledge/[filename]` | 研究文件詳情（rendered markdown、task 連結） |
| `/tasks` | Task Board Kanban（todo/in_progress/blocked/review/done） |
| `/settings` | 系統設定 |
| `/sponsor` | 業配音檔管理 |
| `/thumbnail-compare` | 縮圖 A/B 測試 |
| `/youtube-sources` | YouTube 搜尋來源管理 |

---

## Auto Task Executor（懶懶自動執行）

`dashboard/scripts/auto-task-executor.ts` — macOS launchd 每 3 小時觸發，自動執行 Task Board 上 `auto_execute=1` 的任務。

### 執行流程
1. 抓 `status=todo & auto_execute=1` 的任務（最多 3 個/次）
2. 每個任務切出 `feat/task-{id}-{slug}` branch
3. 組裝 prompt → 執行 `claude -p` → 最多 30 turns、15 分鐘 timeout
4. Research 任務：產出存為 `data/research/task-{id}-{slug}.md`（繁體中文），連結貼到 ticket comments
5. Dev 任務：跑 `npm run build` 驗證，結果貼 ticket
6. 完成 → `status=review`；卡住 → 保持 `in_progress` + BLOCKED 標記 + 完整 context 供下次 pickup

### 安全機制
- 只執行 `auto_execute=1` 的任務
- Feature branch 隔離，不動 main
- Research 優先（唯讀、低風險）
- Lockfile 防重複執行
- 永遠不設 `done`，人工 promote

### Research 文件規範
- 一律使用**繁體中文**撰寫
- 存放於 `dashboard/data/research/task-{id}-{slug}.md`
- 自動索引到 `knowledge_docs` table，在 `/knowledge` 頁面可瀏覽
- Ticket comments 附帶可點擊連結 → `/knowledge/{filename}`

## Utility Scripts

`dashboard/scripts/` 下的測試腳本，開發時用於 smoke test：

| Script | 用途 |
|--------|------|
| `auto-task-executor.ts` | 自動執行 Task Board 任務（launchd 排程） |
| `test-video-creation.ts` | 測試 composite 佈局 + 字幕燒錄（3 分鐘預覽） |
| `test-subtitles.ts` | 測試 Whisper 轉錄 + SRT 生成 |
| `test-soundon.ts` | 測試 SoundOn Playwright 上傳 |
| `test-quality-loop.ts` | 測試品質評分迴圈 |
| `test-topic-pipeline.ts` | 測試完整 pipeline |
| `seed-memory.ts` | 初始化工具記憶 DB |

---

## Key Architectural Patterns

1. **LangGraph Pipeline** — 13-stage linear state machine，每個 node 存 snapshot
2. **Fire-and-Forget** — `/pipeline/start` 立即回傳，pipeline 背景執行
3. **Human Review Gate** — Pipeline 暫停在 `pending_review`，需 `/episodes/:id/approve`
4. **State Snapshots** — 每個 node 輸出存 JSON，支援 `retryFromStage()` 從任意階段重跑
5. **Sponsor Audio Merge** — Pipeline 完成後自動 merge 業配音檔（依 `scheduled_dates` 匹配）
6. **Cost Tracking** — `llm_calls` + `service_costs` 兩張表，episodes 彙整 total cost
7. **Quality Refinement** — 品質評分 < 85 分自動重寫，最多 2 次
8. **Tool Memory** — 工具追蹤 + 家族分類 + 回顧語句自動注入腳本
9. **NotificationHub** — 中央事件派發，fan-out 到 Gmail + Hermes webhook，各 channel 獨立不互相阻擋
10. **Hermes MCP** — stdio MCP server 包裝 REST API 為 ~40 個 tools，讓 Hermes Agent 操控系統
11. **Knowledge Base** — 研究文件自動索引（`data/research/*.md` → `knowledge_docs` table），從 task metadata 自動分類，`/knowledge` 頁面瀏覽
12. **Auto Task Executor** — launchd 排程每 3 小時執行，Claude Code CLI 自動處理 `auto_execute=1` 的任務，feature branch 隔離，完整 comment 紀錄
