# CLAUDE.md

## Project Overview

**AI 懶人報 Podcast Automation** — 全自動 Podcast 產製系統。從 YouTube 影片搜尋、AI 腳本生成、TTS 語音合成、到多平台發布（SoundOn / YouTube / Instagram / Facebook / Threads），全流程自動化，僅在發布前需人工審核。

- **Tech Stack**: Next.js 14 + TypeScript + LangGraph + SQLite
- **Dashboard**: `dashboard/` (主要開發目錄)
- **Database**: SQLite (`dashboard/data/podcast.db`, WAL mode)
- **Agent System**: `dashboard/scripts/agents/` (多 agent 協作系統：懶懶/小企/小工)
- **Hermes Agent**: `hermes/` (AI 營運助手，透過 Telegram 操控系統)
- **Deployment**: Cloudflare Tunnel → `hub.ailanbao.org` → `localhost:3000`
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
- Comment authors：`tommy`（人工）、`hermes`（Hermes Agent）、`claude-code`（auto-task-executor）、`小企`（Planner Agent）、`懶懶`（PM Agent）、`小工`（Engineer Agent）
- `hermes`、`claude-code`、`懶懶` 在 UI 上都顯示為「懶懶」

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

### Video Creation（FFmpeg 影片生成）

**核心概念**：YouTube 影片 = 靜態圖片 + 音檔 + 燒錄字幕。畫面全程不變，只有字幕在切換。

**Service**: `dashboard/src/services/videoCreator.ts`

#### 影片生成流程

1. `thumbnailGenerator.ts` 生成 composite 雙面板圖（左面板=EP+標題，右面板=IG 封面圖）→ 1280×720 JPEG
2. `videoCreator.ts` 用 FFmpeg 合成：靜態圖片 + MP3 音檔 + SRT 字幕 → MP4
3. 上傳 MP4 到 YouTube + 設定縮圖 + 上傳 SRT 作為 closed captions（SEO 用）

#### FFmpeg 編碼參數

```
ffmpeg -loop 1 -framerate {fps} -i {composite.jpg}
       -i {audio.mp3}
       -c:v libx264 -preset ultrafast -tune stillimage
       -crf 28 -g 99999 -r {fps}
       -c:a aac -b:a 192k -pix_fmt yuv420p
       -vf "scale=1280:720:...,subtitles='{srt}':force_style='FontName=Heiti TC,...'"
       -shortest output.mp4
```

| 參數 | 值 | 說明 |
|------|-----|------|
| fps | `2`（有字幕）/ `1`（無字幕） | 靜態圖片不需高 fps，字幕每 2-3 秒切換一次，2fps 足夠 |
| `-tune stillimage` | 永遠啟用 | 靜態畫面壓縮最佳化 |
| `-g 99999` | 永遠啟用 | 超大 keyframe 間距，因為畫面幾乎不變 |
| `-crf 28` | 固定 | 畫質足夠（靜態圖片不需低 CRF） |
| `-preset ultrafast` | 固定 | 最快編碼速度 |
| 解析度 | 1280×720 | 輸入輸出都是 720p |
| 字型 | `Heiti TC`（黑體-繁） | macOS 內建 CJK 字型，必須明確指定否則中文顯示為框框 |
| Timeout | 30 min（有字幕）/ 10 min（無字幕） | spawn + SIGKILL |

#### 字幕燒錄（Hardcoded Subtitles）

- 使用 FFmpeg `subtitles` filter（libass 引擎）將 SRT 燒錄進影片
- **必須指定 `FontName=Heiti TC`**，否則 libass 預設字型不支援中文會顯示 □□□
- 字幕樣式：白字 + 半透明黑底（`BorderStyle=4`），底部置中（`Alignment=2, MarginV=40`）
- SRT 同時也上傳到 YouTube 作為 closed captions（雙軌字幕：硬字幕 + CC）

#### 字幕生成流程

**Service**: `dashboard/src/services/subtitleGenerator.ts`

1. OpenAI Whisper 轉錄音檔 → 取得逐字時間戳
2. 腳本文字與 Whisper 結果對齊（sentence-level alignment）
3. 產生 SRT 格式字幕檔

#### YouTube 縮圖 vs 影片畫面

- **影片畫面**：永遠用 composite 雙面板圖（自動生成，不可選）
- **YouTube 縮圖**：User-selected（review 頁面選擇）或 fallback 到 composite
- 兩者獨立：縮圖是 YouTube metadata，影片畫面是 MP4 內容

#### 效能備註

- 26 分鐘 episode 在 2fps + stillimage 下約 2.5 分鐘編碼完成
- **禁止調高 fps**：10fps 曾導致 15+ 分鐘編碼 + timeout，靜態圖片完全不需要高 fps

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
| `voice/writer` | `services/voice/writer.ts` | 用 Tommy 口吻寫 Threads 草稿；`writeBestOfN()` 生 5 版→評分→挑最爆 |
| `voice/predictorClient` | `services/voice/predictorClient.ts` | 呼叫爆文評分服務（:8765），離線時 graceful fallback 不阻斷寫作 |

---

## 社群爆文評分 Predictor（best-of-N 自我優化）

`/write` 頁面寫 Threads 草稿時，可開「🎯 爆文評分」讓 AI 生 5 版不同角度草稿，用 ML 模型挑「最可能爆」的那版。

### 架構

```
/write → /api/voice/write {bestOf:5} → writeBestOfN()
  1. Gemini 並發生成 5 版草稿（VARIETY_NUDGES 角度）
  2. predictorClient → HTTP → score_service.py (:8765, 保溫模型)
  3. 依 viral_prob 排序 → 回傳最高分 + 候選清單
         ↓ (服務離線時回第一版、scored=false、不阻斷寫作)
  model/bundle.joblib ← train_model.py 產出（含 Tommy 521 篇個人化）
```

### 模型（`experiments/like-predictor/`）

- 從 3 種方法實驗選出 winner = 古典 ML（TF-IDF char n-gram + GBDT）。
- 雙頭：`relative_score`（排序）+ `viral_prob`（爆文機率）。
- target = `log1p(likes) − log1p(作者中位數)`（移除粉絲數干擾）；「爆」= 作者自己 P90。
- 綁定作者 baseline `ai.lanrenbao`（median 27 / p90 178 讚）。
- **訊號中等**（你貼文 held-out 爆文 ROC-AUC ≈0.69）：定位是篩選/第二意見，非準確讚數預言。
- `model/bundle.joblib`（16MB）gitignored，可 `python3 train_model.py` 重訓重生。
- 細節：`docs/superpowers/specs/2026-06-26-like-predictor{,-tool}-design.md`、`experiments/like-predictor/TOOL.md`。

### Ops：啟動評分服務

```bash
# 常駐（launchd，開機自啟）— 一次性安裝
cp experiments/like-predictor/com.podcast.likepredictor.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.podcast.likepredictor.plist
curl -s http://127.0.0.1:8765/health   # {"ok":true} = 成功

# 或前景手動跑
cd experiments/like-predictor && /opt/anaconda3/bin/python3 score_service.py --port 8765
```

> 服務用 `/opt/anaconda3/bin/python3`（需 sklearn/joblib，系統 python 沒有）。
> voice-writer 走環境變數 `LIKE_PREDICTOR_URL`（預設 `http://127.0.0.1:8765`）。
> 資料更新後重訓：`python3 train_model.py` → 重啟服務載入新模型。

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

### Agent System & Telegram
| Variable | Service |
|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API（agent 通知 + quick-action 驗證） |
| `TELEGRAM_CHAT_ID` | Telegram 目標頻道/群組 |
| `DASHBOARD_PUBLIC_URL` | 公開 Dashboard URL（用於 Telegram quick-action 連結，如 `https://hub.ailanbao.org`） |

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
**Agent System**: `agent_discussions`, `agent_proposals`, `agent_memory`, `alerts`
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
| `/agent-log` | Agent 活動紀錄（session logs、agent discussions） |
| `/settings` | 系統設定 |
| `/sponsor` | 業配音檔管理 |
| `/thumbnail-compare` | 縮圖 A/B 測試 |
| `/youtube-sources` | YouTube 搜尋來源管理 |

---

## Multi-Agent System（多 Agent 協作系統）

三個 AI agent 透過 orchestrator 協作，自動提案、執行任務、審核成果，並透過 Telegram 向 Tommy 報告。

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Orchestrator (cron)                        │
│  morning: propose → evaluate → execute → digest              │
│  evening: execute → review → digest → daily summary          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐               │
│  │ 小企       │    │ 懶懶       │    │ 小工       │               │
│  │ Planner   │───►│ PM        │───►│ Engineer  │               │
│  │ 提案+研究  │    │ 評估+審核  │    │ 開發+執行  │               │
│  └──────────┘    └────┬─────┘    └──────────┘               │
│                       │                                      │
│              Telegram 通知 + Quick-Action                     │
│                       ▼                                      │
│                  ┌─────────┐                                 │
│                  │  Tommy  │ approve / reject via Telegram    │
│                  └─────────┘                                 │
└──────────────────────────────────────────────────────────────┘
```

### Agent Roles

| Agent | ID | File | 職責 |
|-------|----|------|------|
| 小企 (Planner) | `planner` | `scripts/agents/planner.ts` | 分析 AI 趨勢、提出內容/研究/優化提案 |
| 懶懶 (PM) | `pm` | `scripts/agents/pm.ts` | 評估提案、審核成果、生成 review digest、發 Telegram 通知 |
| 小工 (Engineer) | `engineer` | `scripts/agents/engineer.ts` | 執行任務（research/dev）、切 feature branch、跑測試 |

### Orchestrator

`dashboard/scripts/agents/orchestrator.ts` — 可手動觸發或透過 macOS launchd 排程。

**協作 mindset（把 Tommy 當老闆）**：團隊有自主權，懶懶 (PM) 守門。低風險高潛力的事懶懶自己拍板讓小工做（不打擾老闆）；只有高風險 / 需要方向決定的才留給老闆。所有對外通知收斂成**每天早上 8 點一則「老闆快報」**，只放需要老闆拍板的事（含 pros/cons + 懶懶建議 + 按鈕）；中間過程全靜音，agent 之間的討論記錄在 task board comments。

| Mode | Flag | Schedule | 流程 |
|------|------|----------|------|
| Morning | `--morning` | 每天 08:00 | 懶懶 review 昨晚遺留 → 發**老闆快報**（唯一對外觸點） |
| Evening | `--evening` | 每天 20:00 | 小企提案 → 懶懶評估（auto_do 直接做 / ask_boss 待決）→ 小工執行 → 懶懶審核（全程靜音） |
| Full | `--full` | 手動 | 晚上 pipeline + 老闆快報（端到端測試用） |
| Execute | `--execute-only` | 手動 | 僅執行任務 |

#### 手動觸發（尚未設定 launchd 時）

```bash
# 確保 Dashboard server 正在跑（localhost:3000）
cd dashboard

# 完整跑一次（提案 + 評估 + 執行 + 審核 + summary）
npx tsx scripts/agents/orchestrator.ts --full

# 只讓小工執行已批准的任務
npx tsx scripts/agents/orchestrator.ts --execute-only

# 早上流程（提案 + 評估 + 執行）
npx tsx scripts/agents/orchestrator.ts --morning

# 晚上流程（執行 + 審核 + summary）
npx tsx scripts/agents/orchestrator.ts --evening
```

前置條件：
1. Dashboard server 必須在跑（`cd dashboard && npm run dev`）
2. `~/.hermes/.env` 需有 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_HOME_CHANNEL`
3. `dashboard/.env.local` 需有 `DASHBOARD_PUBLIC_URL=https://hub.ailanbao.org`
4. Cloudflare Tunnel 需在跑（`cloudflared` launchd service），否則 Telegram quick-action 連結會 404

#### 設定 launchd 自動排程（之後）

```bash
cd dashboard/scripts/agents
bash install-cron.sh
```

Plist 檔案：`com.podcast.orchestrator.morning.plist` / `.evening.plist`

### Task Approval Gate（懶懶守門 + 風險分流）

懶懶 (PM) 評估提案時依**風險**分流，不再每張都先問 Tommy：

1. **auto_do（低風險高潛力）**：懶懶自己拍板 → 建 ticket（`auto_execute=1`）→ 小工立刻執行 → 完成後留在 `review`，由隔天早上的老闆快報讓 Tommy 決定要不要上線。**不事先打擾老闆。**
2. **ask_boss（高風險 / 需方向）**：建 ticket（`auto_execute=0`）留在 `todo`，懶懶把決策（問題 + 選項 pros/cons + 建議）寫成 `discussion` comment → 早上老闆快報端上去。Tommy approve → `auto_execute=1`，下輪小工 pick up；reject → cancelled。
3. **rejected / deferred**：不值得或時機不對 → 靜默結案，不浮上去。
4. 低風險判準：可逆、不花錢、不碰對外發布、不改品牌方向（research / 內容企劃 / 社群草稿 / UI 品質優化）。高風險：infra 架構 / 實際發布 / 花錢 / 品牌定位方向。

### Quick-Action Endpoint

`/api/tasks/quick-action?id={taskId}&action={approve|reject}&token={hmac}`

兩種流程：
- **TODO task**: approve → 啟用 `auto_execute`，reject → 取消
- **REVIEW task**: approve → 標記 `done` + 自動用 `gh pr create` 開 PR，reject → 退回 `in_progress`

HMAC 驗證：`sha256(TELEGRAM_BOT_TOKEN, taskId:action).slice(0, 16)`

### Telegram 老闆快報（Boss Brief, `sendBossBrief`）

懶懶每天早上 8 點發**一則**老闆快報，這是唯一對外觸點（取代舊的 review digest + daily summary）：
- **需要你拍板**：① 成品等上線（review tasks，按鈕 `✅ 上線+開PR` / `❌ 不要`）② 高風險待決（ask_boss todo tasks，附 pros/cons + 懶懶建議，按鈕 `✅ 批准執行` / `❌ 不做`）。各自一則訊息帶 HMAC quick-action 按鈕。
- **團隊自己處理了**：低風險自動完成的，標題一行帶過（FYI，無需決定）。
- 沒有任何要報的事就完全不發（idle 不打擾）。細節都在 board，點 ticket 看完整 discussion 串。

### Task Execution Flow

1. 小工抓 `status=todo & auto_execute=1` 的任務（最多 3 個/次）
2. 每個任務切出 `feat/task-{id}-{slug}` branch
3. 組裝 prompt → 執行 `claude -p` → 最多 30 turns、15 分鐘 timeout
4. Research 任務：產出存為 `data/research/task-{id}-{slug}.md`（繁體中文）
5. Dev 任務：跑 `npm run build` 驗證，結果貼 ticket comments
6. 完成 → `status=review`；卡住 → 保持 `in_progress` + BLOCKED 標記
7. 懶懶自動審核 → 留在 board（review comment），隔天早上彙整進老闆快報（不即時 ping）

### Safety Mechanisms
- 高風險 ticket（ask_boss）預設不執行（`auto_execute=false`），需 Tommy 批准；低風險（auto_do）由懶懶守門後自動執行
- Feature branch 隔離，不動 main
- Research 優先（唯讀、低風險）
- Lockfile 防重複執行
- Agent 永遠不設 `done`，僅到 `review`，人工 promote
- Orchestrator 結束時自動恢復原始 git branch

### Research 文件規範
- 一律使用**繁體中文**撰寫
- 存放於 `dashboard/data/research/task-{id}-{slug}.md`
- 自動索引到 `knowledge_docs` table，在 `/knowledge` 頁面可瀏覽
- Ticket comments 附帶可點擊連結 → `/knowledge/{filename}`

---

## Cloudflare Tunnel（部署）

Dashboard 透過 Cloudflare Tunnel 對外公開，供 Telegram quick-action 和遠端存取使用。

| 項目 | 值 |
|------|-----|
| 公開 URL | `https://hub.ailanbao.org` |
| 本地端 | `http://localhost:3000` |
| 服務 | `cloudflared`（macOS launchd 管理） |
| 設定 | `~/.cloudflared/config.yml` |

Telegram 的 approve/reject 按鈕連結指向 `https://hub.ailanbao.org/api/tasks/quick-action?...`

## Utility Scripts

### Agent Scripts
`dashboard/scripts/agents/` — 多 agent 系統核心：

| Script | 用途 |
|--------|------|
| `orchestrator.ts` | 主入口：排程觸發 morning/evening/full run |
| `base.ts` | 共用基礎（LLM、DB logging、Telegram、prompt assembly） |
| `planner.ts` | 小企 agent：趨勢分析 + 提案 |
| `pm.ts` | 懶懶 agent：評估、審核、review digest、daily summary |
| `engineer.ts` | 小工 agent：執行任務（claude -p）、切 branch、跑測試 |
| `install-cron.sh` | 安裝 launchd plist 排程 |

### Testing Scripts
`dashboard/scripts/` — 開發時用於 smoke test：

| Script | 用途 |
|--------|------|
| `test-video-creation.ts` | 測試 composite 佈局 + 字幕燒錄（3 分鐘預覽） |
| `test-subtitles.ts` | 測試 Whisper 轉錄 + SRT 生成 |
| `test-soundon.ts` | 測試 SoundOn Playwright 上傳 |
| `test-quality-loop.ts` | 測試品質評分迴圈 |
| `test-soundon-scraper.ts` | 測試 SoundOn 數據擷取 |

---

## Key Architectural Patterns

1. **LangGraph Pipeline** — 13-stage linear state machine，每個 node 存 snapshot
2. **Fire-and-Forget** — `/pipeline/start` 立即回傳，pipeline 背景執行
3. **Human Review Gate** — Pipeline 暫停在 `pending_review`，需 `/episodes/:id/approve`
4. **State Snapshots** — 每個 node 輸出存 JSON，支援 `retryFromStage()` 從任意階段重跑
5. **Sponsor Audio Merge** — 在每集審核頁手動選擇業配口播（預設不使用），選定後即時 merge 到音檔前面。字幕＝業配口播字幕（每個 preset 用 Whisper 轉一次、快取在 `sponsor_audio_presets.srt_content`，跨集重用，不每次重轉）＋正片字幕（往後位移業配長+0.3s），拼成 combined SRT 給 YouTube 燒錄/CC。Description 業配文字優先取 episode 選定業配的 `ad_preset`；未選時退回全域唯一 active 的 `ad_preset`（供純文字業配：無口播但仍要 description）。SoundOn 描述用 `descriptionToQuillHtml()` 轉 HTML 再 paste 進 Quill（避免 fill() 爆換行/拆 URL）
6. **Cost Tracking** — `llm_calls` + `service_costs` 兩張表，episodes 彙整 total cost
7. **Quality Refinement** — 品質評分 < 85 分自動重寫，最多 2 次
8. **Tool Memory** — 工具追蹤 + 家族分類 + 回顧語句自動注入腳本
9. **NotificationHub** — 中央事件派發，fan-out 到 Gmail + Hermes webhook，各 channel 獨立不互相阻擋
10. **Hermes MCP** — stdio MCP server 包裝 REST API 為 ~40 個 tools，讓 Hermes Agent 操控系統
11. **Knowledge Base** — 研究文件自動索引（`data/research/*.md` → `knowledge_docs` table），從 task metadata 自動分類，`/knowledge` 頁面瀏覽
12. **Multi-Agent Orchestrator** — 三 agent 協作（小企提案→懶懶評估→小工執行→懶懶審核）。把 Tommy 當老闆：團隊有自主權、懶懶守門，晚上靜默工作、早上 8 點發一則「老闆快報」只放需決定的事
13. **Risk-Based Approval Gate** — 懶懶依風險分流：低風險高潛力自己拍板自動執行（auto_do, `auto_execute=1`）；高風險才建待決 ticket（ask_boss, `auto_execute=0`）等老闆 Telegram approve
14. **Cloudflare Tunnel** — `hub.ailanbao.org` → `localhost:3000`，供 Telegram quick-action 和遠端 Dashboard 存取
15. **Like Predictor (best-of-N)** — Python ML 模型評爆文機率，包成常駐 HTTP 服務（:8765）；voice-writer 生 N 版草稿用它挑最爆，服務離線時 graceful fallback 不阻斷寫作
