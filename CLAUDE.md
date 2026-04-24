# CLAUDE.md

## Git Commit 偏好
- **不要**在 commit message 中加入 `Co-Authored-By` 行

## 專案架構
- **重構方向**: 完全移除 n8n，用 Next.js + LangGraph + SQLite 重建
- **完整計畫**: 見 `docs/platform-refactor-plan.md`
- **Dashboard 專案**: `dashboard/` (Next.js 14 + TypeScript)
- **原有程式碼**: `src/`, `web-console/` 保留至遷移完成
- **資料庫**: SQLite (`dashboard/data/podcast.db`)

---

## 重構進度記錄

### Phase 1: Foundation

#### 2026-04-24 — Steps 1-8: 基礎建設完成
- 更新 CLAUDE.md 加入重構進度記錄區塊
- 初始化 Next.js 14 專案 (`dashboard/`)，安裝 TypeScript, Tailwind, ESLint
- 安裝核心 dependencies: `better-sqlite3`, `pino`, `pino-pretty`, `node-cron`
- 建立 SQLite schema (`dashboard/src/db/schema.sql`) — 7 tables: episodes, tools, episode_tool_mentions, llm_calls, pipeline_runs, youtube_sources, platform_analytics
- 建立 DB connection module (`dashboard/src/db/index.ts`) — WAL mode, auto-migration
- 建立 Pino logger (`dashboard/src/lib/logger.ts`) — dev pretty print, prod JSON
- Port OpenRouterService → `dashboard/src/services/llmService.ts` — 新增自動 LLM call logging 到 llm_calls table（model, tokens, cost, latency）
- 建立 API routes: `/api/health`, `/api/episodes` (GET/POST), `/api/pipeline/status`
- 建立 Dashboard 首頁 (`dashboard/src/app/page.tsx`) — 顯示 DB 狀態、episodes 數、pipeline runs
- 更新 `.gitignore` — 加入 dashboard 相關忽略規則
- **驗證通過**: build 成功、health API 回傳 `{status: "ok", db: "connected", tables: 7}`、episodes 回傳空陣列

#### 2026-04-24 — Steps 9-12: Google Services + Scheduler
- 安裝 `googleapis`, `fs-extra` 及其 type definitions
- 建立 shared Google Auth module (`dashboard/src/lib/googleAuth.ts`) — OAuth2 token load/save/refresh，Drive/Gmail/YouTube 共用
- Port GoogleDriveService → `dashboard/src/services/googleDrive.ts` — 上傳/下載/串流，使用 shared auth
- Port GmailService → `dashboard/src/services/gmail.ts` — 標題選擇/縮圖選擇 email 發送
- Port YouTubeService → `dashboard/src/services/youtube.ts` — 影片上傳、縮圖設定、頻道資訊
- 建立 Scheduler service (`dashboard/src/services/scheduler.ts`) — node-cron 排程管理，支援 register/start/stop/manual trigger
- 新增 API route: `/api/scheduler/status`
- **驗證通過**: build 成功，6 個 routes 正常（含 `/api/scheduler/status`）
- **Phase 1 完成** — Foundation layer 全部到位

### Phase 2: Content Pipeline (LangGraph)

#### 2026-04-24 — LangGraph Pipeline 建置
- 安裝 `@langchain/langgraph`, `@langchain/core`
- 定義 Pipeline State (`dashboard/src/services/pipeline/state.ts`) — 完整的 PipelineState 型別，含 videos, scripts, quality, meta, audio 等欄位
- 建立 7 個 Pipeline Nodes:
  - `fetchYoutube.ts` — YouTube Data API v3 搜尋 + Apify 字幕擷取，去重、篩選（views/likes/duration）、取 top 5
  - `classify.ts` — Gemini Flash Lite 分類（is_tool/not_tool 或 is_robotics/non_robotics），parallel execution
  - `scriptEnglish.ts` — Gemini Pro 生成 5000-6000 字英文講稿
  - `translate.ts` — Gemini Pro 翻譯為台灣繁體中文口語化，保留英文工具名
  - `qualityScore.ts` — 4 維度評分（accuracy, engagement, structure, naturalness），threshold 85 分，max 2 次 refinement
  - `generateMeta.ts` — 10 個候選標題 → 選最佳 → 生成描述 → 生成 YouTube tags（完整 port contentGenerator.js 邏輯）
  - `tts.ts` — VoAI TTS 合成（完整 port voai.js: 300 字 chunk → batch-5 → FFmpeg concat）
  - `publish.ts` — SoundOn + YouTube 發布（Phase 3 完整實作，目前 placeholder）
- 建立 LangGraph StateGraph (`dashboard/src/services/pipeline/graph.ts`) — 使用 Annotation API，linear flow: START → fetch → classify → script → translate → quality → meta → tts → END
- Pipeline 完成後自動更新 episodes + pipeline_runs tables
- 新增 API routes:
  - `POST /api/pipeline/start` — 啟動 pipeline（episodeNumber + segmentType）
  - `POST /api/episodes/:id/approve` — 人工審核通過後觸發發布
- **驗證通過**: build 成功，8 個 routes 正常
- **Phase 2 核心完成** — LangGraph pipeline 取代 n8n workflow
