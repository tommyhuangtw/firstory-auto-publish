# AI Podcast Automation Platform — Full Rebuild Plan (n8n-Free)

## Context

現有系統是 n8n workflows + Node.js 的混合架構。n8n 負責最核心的 AI content pipeline（YouTube 搜尋 → AI 分類 → 講稿生成 → TTS → 發布），但這些邏輯被封裝在 no-code 工具裡，面試官看不到程式碼。

**目標：** 完全移除 n8n，用 Node.js + LangGraph 重建整個平台，打造一個能在 FDE 面試中 demo 的 production system。

**為什麼移除 n8n：**
1. n8n 是 no-code 工具 — FDE 面試官看的是 production-grade code，不是 workflow screenshot
2. 核心 AI pipeline 邏輯被 n8n 封裝 — 最有展示價值的部分（content sourcing → AI classification → script generation）看不到程式碼
3. n8n + Node.js 的 webhook bridge 是 anti-pattern — 面試時很難解釋「為什麼不在同一個系統裡做」

**設計原則：**
- 所有核心邏輯都是 code（可 review、可測試、可展示）
- SQLite 取代 Airtable 成為 source of truth
- LangGraph 用在有 genuine value 的地方（pipeline orchestration、checkpoint/resume）
- Docker-ready，開發期本機 Mac 跑，production 部署 AWS (Lightsail/EC2)

---

## Architecture

```
                    ┌─────────────────────────────────┐
                    │     Next.js Dashboard (UI)       │
                    │  /episodes  /analytics  /review  │
                    │  /memory    /pipeline   /settings │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │   Next.js API Routes + Express   │
                    │   /api/pipeline  /api/episodes    │
                    │   /api/analytics /api/webhooks    │
                    └──────────────┬──────────────────┘
                                   │
         ┌──────────┬──────────┬───┴───┬──────────┬──────────┐
         │          │          │       │          │          │
    ┌────▼───┐ ┌───▼────┐ ┌──▼──┐ ┌──▼───┐ ┌───▼────┐ ┌──▼────┐
    │Pipeline│ │Memory  │ │Eval │ │Publi-│ │Analy-  │ │Sched- │
    │Engine  │ │Service │ │& Log│ │sher  │ │tics    │ │uler   │
    │(Lang-  │ │(SQLite │ │(cost│ │(Sound│ │(YT/Pod │ │(node- │
    │Graph)  │ │+tools) │ │qual)│ │On/YT)│ │cast)   │ │cron)  │
    └────────┘ └────────┘ └─────┘ └──────┘ └────────┘ └───────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │         SQLite (single file)     │
                    │  episodes, tools, llm_calls,     │
                    │  analytics, pipeline_runs        │
                    └─────────────────────────────────┘
```

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | Next.js 14 + TypeScript + shadcn/ui + Recharts | FDE 面試標配 full-stack framework |
| API | Next.js API Routes (main) + Express middleware (Playwright tasks) | API routes 處理 CRUD，Express 處理長時間任務 |
| Pipeline | LangGraph.js StateGraph | Checkpoint/resume、parallel execution、state observability |
| Database | SQLite (better-sqlite3) | $0、<1ms、零部署、展示 schema design |
| LLM | OpenRouter (multi-model routing) | 已有，保留 |
| Scheduler | node-cron | 輕量，取代 n8n schedule trigger |
| Logging | Pino (structured JSON logs) | Production-grade，比 console.log 強 |
| Deploy | Docker + Local Mac (dev) → AWS Lightsail (prod) + Cloudflare Tunnel | 開發期本機，production 部署 AWS |

---

## Database Architecture Decision: SQLite vs Airtable vs Cloud DB

### 為什麼從 Airtable 遷移到 SQLite

```
現狀：Airtable（no-code 資料庫）
  → 跟 n8n 一樣的問題：面試官看不到 schema design
  → 無法做 JOIN、aggregate query、transaction
  → API rate limit（5 req/sec）影響 pipeline 效能

目標：SQLite（structured DB）
  → 完整的 SQL schema，展示 DB design 能力
  → $0 成本、<1ms 延遲、零部署複雜度
  → 支援 JOIN、aggregate、transaction
  → 單檔案，backup 就是 copy
```

### Trade-off 比較

|  | SQLite (選擇) | Airtable (現狀) | PostgreSQL |
|---|---|---|---|
| Schema 展示 | 完整 SQL DDL | GUI 設定，看不到 | 完整 SQL DDL |
| 成本 | $0 | $0 (Free tier) | $0-25/mo |
| 延遲 | <1ms | 100-300ms (network) | 20-100ms |
| 部署複雜度 | 零，一個檔案 | 零 | connection + migration |
| 面試時 | 能講 schema design | 「我用 Airtable 存」| 能講但 over-engineered |

### 面試時的講法

> 「我從 Airtable 遷移到 SQLite，因為：(1) 需要 JOIN 和 aggregate 來做 analytics，Airtable API 做不到；(2) LLM call logging 每集產生 8-10 筆記錄，Airtable 的 5 req/sec rate limit 會是瓶頸；(3) 單人系統不需要 PostgreSQL 的 multi-user 能力。如果要做成 SaaS，會遷移到 PostgreSQL。」

---

## Database Schema (SQLite)

```sql
-- 集數管理 + 審核佇列
CREATE TABLE episodes (
  id INTEGER PRIMARY KEY,
  episode_number INTEGER UNIQUE,
  segment_type TEXT NOT NULL,        -- 'daily' | 'weekly' | 'robot'
  status TEXT NOT NULL DEFAULT 'generating',
  -- 'generating' → 'pending_review' → 'approved' → 'publishing' → 'published' | 'rejected'

  -- Content
  script_en TEXT,                     -- English script
  script_zh TEXT,                     -- Chinese script (for TTS)
  candidate_titles TEXT,              -- JSON: 10 title candidates
  selected_title TEXT,
  description TEXT,
  tags TEXT,                          -- JSON array

  -- Media
  audio_path TEXT,                    -- local path or Drive ID
  cover_path TEXT,

  -- Source videos
  source_videos TEXT,                 -- JSON: [{videoId, title, views, ...}]

  -- Quality & Cost
  quality_score REAL,
  total_cost_usd REAL,
  script_word_count INTEGER,

  -- Publish results
  soundon_url TEXT,
  youtube_url TEXT,
  ig_post_id TEXT,

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')),
  approved_at TEXT,
  published_at TEXT
);

-- 工具記憶系統
CREATE TABLE tools (
  id INTEGER PRIMARY KEY,
  canonical_name TEXT UNIQUE NOT NULL,
  aliases TEXT,                       -- JSON array
  category TEXT,                      -- 'LLM' | 'DevTool' | 'Image' | 'Audio' | ...
  first_episode INTEGER REFERENCES episodes(episode_number),
  latest_episode INTEGER,
  mention_count INTEGER DEFAULT 0,
  evolving_summary TEXT
);

CREATE TABLE episode_tool_mentions (
  id INTEGER PRIMARY KEY,
  episode_number INTEGER NOT NULL,
  tool_id INTEGER REFERENCES tools(id),
  mention_type TEXT,                  -- 'new' | 'update' | 'deep_dive' | 'brief'
  context_snippet TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- LLM 呼叫追蹤（Evaluation Framework 核心）
CREATE TABLE llm_calls (
  id INTEGER PRIMARY KEY,
  episode_number INTEGER,
  stage TEXT NOT NULL,                -- 'classify' | 'script_en' | 'script_zh' | 'scoring' | 'title_gen' | ...
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  latency_ms INTEGER,
  quality_score REAL,                 -- if applicable
  success INTEGER DEFAULT 1,
  error_message TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Pipeline 執行記錄
CREATE TABLE pipeline_runs (
  id INTEGER PRIMARY KEY,
  episode_number INTEGER,
  segment_type TEXT,
  status TEXT,                        -- 'running' | 'completed' | 'failed' | 'paused'
  current_stage TEXT,
  checkpoint_data TEXT,               -- JSON: LangGraph checkpoint
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  error_log TEXT
);

-- YouTube 影片來源追蹤
CREATE TABLE youtube_sources (
  id INTEGER PRIMARY KEY,
  video_id TEXT UNIQUE NOT NULL,
  title TEXT,
  channel_name TEXT,
  published_at TEXT,
  view_count INTEGER,
  like_count INTEGER,
  comment_count INTEGER,
  duration_seconds INTEGER,
  transcript TEXT,
  classification TEXT,                -- 'is_tool' | 'not_tool' | 'is_robotics'
  used_in_episode INTEGER,
  fetched_at TEXT DEFAULT (datetime('now'))
);

-- 平台流量分析
CREATE TABLE platform_analytics (
  id INTEGER PRIMARY KEY,
  episode_number INTEGER,
  platform TEXT,                      -- 'youtube' | 'soundon' | 'spotify' | 'apple'
  date TEXT,
  views INTEGER,
  listens INTEGER,
  likes INTEGER,
  comments INTEGER,
  avg_listen_duration_sec INTEGER,
  fetched_at TEXT DEFAULT (datetime('now'))
);
```

---

## LLM Evaluation Framework

### 核心理念

FDE 面試官最想看的不是「你用了哪些 AI model」，而是：
1. **你怎麼 evaluate AI 的輸出品質？**
2. **你怎麼在 quality 和 cost 之間做 tradeoff？**
3. **你有數據支撐你的決策嗎？**

### 實作方式

每次 LLM call 自動記錄到 `llm_calls` table（透過包裝 OpenRouterService）：

```typescript
// llmService.ts — wraps OpenRouterService with auto-logging
async function callLLM(params: {
  stage: string;
  model: string;
  messages: Message[];
  episodeNumber?: number;
}): Promise<LLMResponse> {
  const start = Date.now();
  const result = await openRouter.chat(params);

  db.prepare(`INSERT INTO llm_calls (episode_number, stage, model,
    input_tokens, output_tokens, cost_usd, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(params.episodeNumber, params.stage, params.model,
      result.usage.input, result.usage.output, calculateCost(result), Date.now() - start);

  return result;
}
```

### Dashboard 呈現的 Metrics

**Cost Efficiency：**
- Cost per episode trend（目標：逐步降低）
- Cost breakdown by stage（哪個 stage 最貴？值得嗎？）
- Quality-per-dollar metric = quality_score / cost_usd

**Quality Tracking：**
- 品質分數趨勢（移動平均）
- 各維度分數分布
- Refinement iteration 效益：第 N 次迭代的平均提升幅度

**Model Selection Evidence：**
- 同一 stage 不同 model 的 score 分布 + cost 比較
- 迭代次數 vs 邊際品質提升（證明「2 次迭代」的 threshold 決策）

### Demo 時的故事線

> 「你可以看到：
> 1. 我用 Gemini Flash Lite 做分類（$0.001/call），不用 Pro（$0.05/call），因為分類準確度差異 <2%，但成本差 50x
> 2. 品質 threshold 設 85 分，因為數據顯示 85 以上的集數完播率較好
> 3. Refinement 最多跑 2 次，因為第 3 次的邊際提升平均只有 1.5 分，不值得多花 $0.3」

---

## LangGraph Content Pipeline

核心取代 n8n 的 workflow logic。每個 stage 是 StateGraph 中的一個 node：

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────────┐
│ 1.Fetch  │───▶│2.Classify│───▶│3.Script  │───▶│4.Translate│
│ YouTube  │    │ (Gemini  │    │ English  │    │ → 繁中     │
│ + Trans- │    │  Flash)  │    │ (Gemini  │    │ (Gemini   │
│ cripts   │    │          │    │  Pro)    │    │  Pro)     │
└──────────┘    └──────────┘    └──────────┘    └─────┬─────┘
                                                      │
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌─────▼─────┐
│8.Publish │◀───│7.Review  │◀───│6.Upload  │◀───│5.Quality  │
│ SoundOn/ │    │ (human   │    │ Google   │    │ Score +   │
│ YT / IG  │    │  approve)│    │ Drive    │    │ TTS       │
└──────────┘    └──────────┘    └──────────┘    └───────────┘
```

### Pipeline Stages 詳解

**Stage 1: Fetch YouTube + Transcripts**
- YouTube Data API v3 搜尋（5 組 AI 相關關鍵字）
- 篩選：duration ≥ 300s, views > 5000, likes > 50, comments > 20
- 去重：排除已用過的 videoId（查 youtube_sources table）
- Apify YouTube Transcript Scraper 提取字幕（8 秒 rate limit）
- 取 top 5 by view count

**Stage 2: AI Classification**
- Model: Gemini Flash Lite（成本最低）
- 分類：`is_tool` / `not_tool`（daily/weekly）或 `is_robotics` / `non_robotics`（robot）
- 排除：非英語、非技術、投機內容

**Stage 3: English Script Generation**
- Model: Gemini Pro
- 5000-6000 words, conversational podcast narration
- Input: top 5 video summaries with transcripts

**Stage 4: Chinese Translation & Localization**
- Model: Gemini Pro
- 4000-5000 words, 台灣繁體中文口語化
- 保留英文：工具名稱、平台名、技術術語
- 用語轉換：視頻→影片、點贊→按讚、帖子→貼文

**Stage 5: Quality Scoring + TTS**
- Quality scoring（max 2 iterations, threshold 85）
- Custom content insertion（from Google Docs）
- VoAI TTS 合成（300 words/chunk → merge）

**Stage 6: Upload to Google Drive**
- 上傳音檔 + 生成分享連結

**Stage 7: Human Review（pipeline pauses here）**
- 狀態設為 `pending_review`
- 推播通知（Email / LINE）
- 等待用戶在 Dashboard approve

**Stage 8: Publish**
- SoundOn（Playwright headless）
- YouTube（API upload + thumbnail）
- Instagram（Graph API）

### LangGraph Genuine Value

1. **Checkpoint/Resume** — TTS 失敗不需要重跑 YouTube 搜尋 + 講稿生成
2. **State observability** — 每個 stage 的 input/output 可追蹤
3. **Parallel execution** — classify 多支影片可以併行
4. **Conditional edges** — quality score < 85 → re-enter scoring loop

---

## Mobile-Ready 審核發布流程

### 三階段架構

```
Stage 1: Generate（全自動，LangGraph pipeline）
  Pipeline 跑完 stage 1-6 → status = 'pending_review' → 推播通知

Stage 2: Review（手機上操作）
  打開 Dashboard → 播放音檔 → 選標題 → 按「Approve & Publish」

Stage 3: Publish（伺服器自動執行）
  收到 approve → Playwright 上傳 SoundOn → YouTube API → IG Graph API
```

### API Endpoints

```
GET  /api/episodes/pending          → 列出待審核集數
GET  /api/episodes/:id/audio        → Proxy Google Drive 音檔 streaming
POST /api/episodes/:id/approve      → 確認發布（帶 selected_title, description）
POST /api/episodes/:id/reject       → 退回（帶 rejection_reason）
GET  /api/episodes/:id/status       → 發布進度
```

### 遠端存取

- **Cloudflare Tunnel**（免費、穩定、自訂域名）
- `podcast.yourdomain.com` → 從手機瀏覽器存取
- Playwright 跑在 server 端（headless），手機只是 remote control

---

## Key Services (File Structure)

```
src/
├── db/
│   ├── index.ts              # better-sqlite3 connection + migrations
│   └── schema.sql            # All CREATE TABLE statements
├── services/
│   ├── pipeline/
│   │   ├── graph.ts          # LangGraph StateGraph definition
│   │   ├── nodes/
│   │   │   ├── fetchYoutube.ts    # YouTube search + Apify transcript
│   │   │   ├── classify.ts        # Gemini Flash classification
│   │   │   ├── scriptEnglish.ts   # English script generation
│   │   │   ├── translate.ts       # Chinese localization
│   │   │   ├── qualityScore.ts    # GPT scoring + refinement loop
│   │   │   └── tts.ts             # VoAI TTS synthesis
│   │   └── state.ts          # Pipeline state type definition
│   ├── memory/
│   │   ├── memoryService.ts  # Tool extraction + enrichment
│   │   └── toolExtractor.ts  # LangChain StructuredOutputParser
│   ├── publisher/
│   │   ├── soundon.ts        # Playwright SoundOn upload (from existing)
│   │   ├── youtube.ts        # YouTube API upload (from existing)
│   │   └── instagram.ts      # IG Graph API (from n8n logic)
│   ├── analytics/
│   │   ├── youtubeAnalytics.ts    # YouTube Analytics API
│   │   └── collector.ts           # Scheduled analytics collection
│   ├── shorts/               # Keep existing shortsPipeline (refactor later)
│   ├── llmService.ts         # OpenRouter wrapper + auto-logging to llm_calls
│   ├── scheduler.ts          # node-cron schedule management
│   ├── googleDrive.ts        # Keep existing
│   └── gmail.ts              # Keep existing
├── utils/
│   ├── logger.ts             # Pino structured logging
│   └── flowHelpers.ts        # Keep existing utilities
└── types/
    └── index.ts              # Shared TypeScript types
```

---

## Reusable Code (Keep As-Is or Minor Refactor)

~70% 的現有程式碼可以直接復用：

| Existing File | Reuse Strategy |
|---------------|----------------|
| `src/services/openRouterService.js` | Wrap with LLM call logging → `llmService.ts` |
| `src/services/youtube.js` | Keep, add TypeScript types |
| `src/services/gmail.js` | Keep, minor refactor for Next.js integration |
| `src/services/googleDrive.js` | Keep as-is |
| `src/services/contentGenerator.js` | Keep title/description generation logic |
| `src/utils/flowHelpers.js` | Keep utility functions |
| `src/soundon-uploader.js` | Keep Playwright automation |
| `src/services/shortsPipeline/*` | Keep entire pipeline, refactor to LangGraph later |
| `remotion/*` | Keep as-is |

---

## Dashboard Pages (Next.js)

### /episodes — Episode Management
- List all episodes with status badges (generating → pending → published)
- Filter by segment type, date range, status
- Click into episode detail: script, source videos, quality score, cost breakdown

### /review — Mobile-Ready Review & Approve
- Pending episodes list
- Audio player (streaming from Google Drive)
- Title selection (10 candidates)
- Description edit
- One-tap "Approve & Publish"
- **Responsive design** — 手機可用

### /analytics — Platform Analytics
- Views/listens per episode (YouTube + podcast platforms)
- Audience retention trends
- Top episodes ranking
- Growth charts (subscribers, total listens over time)
- 「哪些主題最多人看？」→ 用數據決定內容方向

### /pipeline — Pipeline Monitor
- Current running pipelines with stage progress
- Historical runs with success/fail rates
- Cost per run breakdown
- Checkpoint status (can resume failed runs)

### /metrics — LLM Evaluation Dashboard
- **Cost tracking**: Cost per episode trend, cost breakdown by stage
- **Quality tracking**: Quality score trend (moving average), score distribution
- **Model comparison**: Same stage, different models → quality vs cost scatter plot
- **Refinement ROI**: Iteration count vs marginal quality gain

### /memory — Tool Knowledge Base
- All tracked tools with mention frequency
- Tool timeline (when first/last mentioned)
- Search and browse tool database

---

## 不該做的事

1. **不要加 Kubernetes / message queue** — 單機跑，Docker Compose 就夠
2. **不要全部 LLM call 都包 LangChain** — 只在 pipeline orchestration 有 genuine value
3. **不要加 vector DB** — 這是結構化查詢問題，SQLite 是正確選擇
4. **不要建 auth 系統** — 單人使用，保持簡單
5. **不要過度抽象** — 保持 services 簡單直接，不要為了「乾淨架構」而增加不必要的 abstraction layers

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
**Goal: SQLite + core services + basic API**

1. Initialize Next.js project with TypeScript
2. Set up SQLite schema + `better-sqlite3` connection
3. Port `openRouterService.js` → `llmService.ts` with auto `llm_calls` logging
4. Set up Pino logger
5. Create basic API routes: `/api/episodes`, `/api/pipeline/status`
6. Port Google Drive, Gmail, YouTube services to TypeScript
7. Set up `node-cron` scheduler with config

### Phase 2: Content Pipeline (Week 2-3)
**Goal: LangGraph pipeline replaces n8n's core logic**

1. Build LangGraph StateGraph with all 8 nodes
2. Migrate n8n's prompt templates
3. Implement checkpoint persistence to SQLite
4. Add pipeline_runs tracking
5. API: `/api/pipeline/start`, `/api/pipeline/:id/status`, `/api/pipeline/:id/resume`

### Phase 3: Review Flow + Publisher (Week 3-4)
**Goal: Mobile-ready review → one-tap publish**

1. Build episode review UI (responsive, mobile-first)
2. Audio streaming proxy (Google Drive → browser)
3. Publisher: SoundOn (Playwright) + YouTube (API) + IG (Graph API)
4. Set up Cloudflare Tunnel for remote access

### Phase 4: Memory System (Week 4-5)
**Goal: Episodes reference past mentions naturally**

1. Build tool extraction (LangChain StructuredOutputParser + Zod)
2. Memory enrichment: query tools → generate 回顧語句
3. Inject enrichment into Chinese script before TTS
4. Memory browsing UI in dashboard

### Phase 5: Evaluation & Analytics (Week 5-6)
**Goal: Data-driven quality & cost optimization**

1. LLM Evaluation Dashboard (Recharts)
2. Platform Analytics Collector (YouTube Analytics API + SoundOn scraper)
3. Analytics dashboard with top episodes, growth trends

### Phase 6: Production Hardening (Week 6-7)
**Goal: Deploy to AWS, production-ready**

1. Docker multi-stage build (Node.js + Playwright + FFmpeg)
2. AWS Lightsail setup (4GB RAM) + Docker Compose
3. Cloudflare Tunnel (custom domain)
4. Structured logging with log rotation
5. Health checks + alerting
6. Migrate historical data from Airtable → SQLite
7. Run 3-5 episodes end-to-end on AWS

---

## Verification Plan

1. **Pipeline E2E**: Trigger daily pipeline → verify YouTube fetch → classification → script → TTS → audio file generated
2. **Review Flow**: Open dashboard on phone → play audio → select title → approve → verify SoundOn + YouTube uploads
3. **Checkpoint/Resume**: Kill pipeline at stage 4 → resume → verify it continues from checkpoint
4. **Memory**: Run 2 episodes mentioning "Claude Code" → verify second episode generates 回顧語句
5. **Evaluation**: Run 5 episodes → verify cost/quality charts render correctly
6. **Analytics**: Verify YouTube view counts match YouTube Studio numbers
7. **Remote Access**: Access `podcast.yourdomain.com` from phone on cellular network

---

## Portfolio Demo Story

面試時打開 dashboard：

> 1. **Pipeline Monitor** — 「這是一個 LangGraph pipeline，每天自動搜 YouTube、用 Gemini 分類篩選、生成講稿、TTS 合成。每個 stage 有 checkpoint，失敗可以從斷點 resume，不用重跑整個流程。」
>
> 2. **LLM Evaluation** — 「每次 LLM call 都有記錄。你可以看到我用 Gemini Flash Lite 做分類（$0.001/call），Gemini Pro 寫稿（$0.05/call）——這不是隨便選的，是因為跑過 model comparison，分類準確度差異 <2%，但成本差 50x。」
>
> 3. **Mobile Review** — 「我在手機上就能審核。播放音檔、選標題、一鍵發布到 SoundOn + YouTube + IG。Cloudflare Tunnel 讓我不需要 VPN。」
>
> 4. **Memory System** — 「每次提到一個 AI 工具，系統會查它之前出現過幾次、什麼時候提過。如果是回訪工具，自動生成回顧語句。這是用 SQLite 做的，不是 Vector DB——因為這是結構化查詢問題，不是語意搜尋。」
>
> 5. **Analytics** — 「這裡可以看到每集的 YouTube 觀看數、Podcast 收聽數。我可以看哪些主題最受歡迎，用數據決定未來要做什麼內容。」
>
> 6. **System Design** — 「整個系統是 Next.js + LangGraph + SQLite，Docker 部署在 AWS Lightsail。沒有用 n8n、沒有用 Airtable、沒有用 Vector DB——每個技術選擇都有數據和理由支撐。」
