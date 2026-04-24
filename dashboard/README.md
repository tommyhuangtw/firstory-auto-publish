# AI Podcast Dashboard

Next.js + LangGraph + SQLite 全端管理平台，取代原本 n8n + Airtable 的混合架構。

所有核心邏輯都是 TypeScript 程式碼 — 可 review、可測試、可展示。

## Architecture

```
┌─────────────────────────────────┐
│     Next.js Dashboard (UI)       │
│  /episodes  /analytics  /review  │
└──────────────┬──────────────────┘
               │
┌──────────────▼──────────────────┐
│       Next.js API Routes         │
│  /api/pipeline  /api/episodes    │
│  /api/health    /api/scheduler   │
└──────────────┬──────────────────┘
               │
    ┌──────────┼──────────┐
    │          │          │
┌───▼───┐ ┌───▼───┐ ┌───▼───┐
│Pipeline│ │Google │ │Sched- │
│Engine  │ │APIs   │ │uler   │
│(Lang-  │ │(Drive,│ │(node- │
│Graph)  │ │Gmail, │ │cron)  │
│        │ │YT)    │ │       │
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
| Frontend | Next.js 14 + TypeScript + Tailwind | Full-stack, SSR |
| Pipeline | LangGraph.js StateGraph | Checkpoint/resume, state observability |
| Database | SQLite (better-sqlite3, WAL mode) | $0, <1ms, zero deploy |
| LLM | OpenRouter (Gemini Flash/Pro) | Multi-model routing, auto cost logging |
| TTS | VoAI (台灣口音) | Production voice quality |
| Scheduler | node-cron | Lightweight cron replacement |
| Logging | Pino (structured JSON) | Production-grade |

## Quick Start

```bash
cd dashboard
npm install
npm run dev
```

Open http://localhost:3000

### Environment Variables

```bash
# Required
OPENROUTER_API_KEY=        # LLM calls (Gemini via OpenRouter)

# Google APIs (shared OAuth)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Optional
YOUTUBE_API_KEY=           # YouTube Data API v3 (video search)
APIFY_API_TOKEN=           # Apify (YouTube transcript scraper)
VOAI_API_KEY=              # VoAI TTS synthesis
RECIPIENT_EMAIL=           # Gmail notification recipient
```

Token files are stored in `../temp/` (google-tokens.json, youtube-tokens.json) — run the original `src/` auth flow first, then dashboard reuses the same tokens.

## API Endpoints

### Core

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | DB connection + table count |
| GET | `/api/episodes` | List all episodes |
| POST | `/api/episodes` | Create episode |
| GET | `/api/pipeline/status` | Recent pipeline runs + stats |
| GET | `/api/scheduler/status` | Cron job status |

### Pipeline

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/pipeline/start` | Start content pipeline |
| POST | `/api/episodes/:id/approve` | Approve & publish episode |

#### Start Pipeline

```bash
curl -X POST http://localhost:3000/api/pipeline/start \
  -H 'Content-Type: application/json' \
  -d '{"episodeNumber": 300, "segmentType": "daily"}'
```

`segmentType`: `daily` | `weekly` | `robot`

#### Approve Episode

```bash
curl -X POST http://localhost:3000/api/episodes/300/approve \
  -H 'Content-Type: application/json' \
  -d '{"selectedTitle": "Custom Title Here"}'
```

## LangGraph Content Pipeline

7 nodes, linear flow — replaces n8n workflow:

```
START → fetchYoutube → classify → scriptEnglish → translate
      → scoreQuality → generateMeta → synthesizeTts → END
```

| Node | Model | What it does |
|------|-------|-------------|
| **fetchYoutube** | YouTube Data API | Search 5 keyword groups, filter by views/likes/duration, fetch transcripts via Apify |
| **classify** | Gemini Flash Lite | Classify videos as `is_tool`/`not_tool` or `is_robotics`/`non_robotics` (parallel) |
| **scriptEnglish** | Gemini Pro | Generate 5000-6000 word English podcast script |
| **translate** | Gemini Pro | Translate to Taiwan Traditional Chinese, keep tool names in English |
| **scoreQuality** | Gemini Flash | Score on 4 dimensions (accuracy, engagement, structure, naturalness). Refine if < 85, max 2 iterations |
| **generateMeta** | Gemini Flash | 10 title candidates → select best → description → YouTube tags |
| **synthesizeTts** | VoAI API | Split text → 300-char chunks → batch-5 synthesis → FFmpeg concat |

After pipeline completes, episode status = `pending_review`. Approve via API or dashboard UI to trigger publishing (SoundOn + YouTube).

## Database Schema

7 tables in SQLite:

- **episodes** — Episode lifecycle (generating → pending_review → approved → published)
- **tools** — AI tool memory system (canonical names, aliases, mention counts)
- **episode_tool_mentions** — Episode ↔ Tool many-to-many with context
- **llm_calls** — Every LLM call logged: model, tokens, cost, latency, quality score
- **pipeline_runs** — Pipeline execution history with checkpoint data
- **youtube_sources** — YouTube video cache (dedup across episodes)
- **platform_analytics** — Cross-platform analytics (YouTube, SoundOn, Spotify)

Schema: `src/db/schema.sql`

## Project Structure

```
dashboard/
├── src/
│   ├── app/
│   │   ├── page.tsx                        # Dashboard home
│   │   └── api/
│   │       ├── health/route.ts
│   │       ├── episodes/route.ts
│   │       ├── episodes/[id]/approve/route.ts
│   │       ├── pipeline/start/route.ts
│   │       ├── pipeline/status/route.ts
│   │       └── scheduler/status/route.ts
│   ├── db/
│   │   ├── index.ts                        # SQLite connection (WAL, auto-migrate)
│   │   └── schema.sql                      # 7 tables DDL
│   ├── lib/
│   │   ├── googleAuth.ts                   # Shared OAuth2 (Drive/Gmail/YouTube)
│   │   └── logger.ts                       # Pino structured logging
│   └── services/
│       ├── llmService.ts                   # OpenRouter wrapper + auto llm_calls logging
│       ├── googleDrive.ts                  # Drive upload/download/stream
│       ├── gmail.ts                        # Title/thumbnail selection emails
│       ├── youtube.ts                      # Video upload + thumbnail
│       ├── scheduler.ts                    # node-cron job manager
│       └── pipeline/
│           ├── state.ts                    # PipelineState type definition
│           ├── graph.ts                    # LangGraph StateGraph + startPipeline()
│           └── nodes/
│               ├── fetchYoutube.ts         # YouTube search + Apify transcripts
│               ├── classify.ts             # Gemini Flash Lite classification
│               ├── scriptEnglish.ts        # English script generation
│               ├── translate.ts            # Chinese translation
│               ├── qualityScore.ts         # 4-dimension scoring + refinement
│               ├── generateMeta.ts         # Titles, description, tags
│               ├── tts.ts                  # VoAI TTS + FFmpeg concat
│               └── publish.ts              # SoundOn + YouTube (Phase 3)
└── data/
    └── podcast.db                          # SQLite database (auto-created)
```

## LLM Cost Tracking

Every LLM call is automatically logged to `llm_calls` table:

```sql
SELECT stage, model,
       AVG(cost_usd) as avg_cost,
       AVG(latency_ms) as avg_latency,
       COUNT(*) as calls
FROM llm_calls
GROUP BY stage, model;
```

Model selection rationale:
- **Classification**: Gemini Flash Lite ($0.001/call) — accuracy diff vs Pro < 2%, cost diff 50x
- **Script/Translation**: Gemini Pro ($0.05/call) — creative quality matters here
- **Scoring/Meta**: Gemini Flash ($0.01/call) — structured output, speed > creativity

## Development Status

- [x] Phase 1: Foundation (SQLite, services, API routes)
- [x] Phase 2: LangGraph content pipeline (7 nodes)
- [ ] Phase 3: Review UI + Publisher (mobile-responsive, SoundOn Playwright, YouTube API)
- [ ] Phase 4: Memory system (tool extraction, cross-episode references)
- [ ] Phase 5: Evaluation dashboard (Recharts cost/quality charts)
- [ ] Phase 6: Production deploy (Docker, AWS Lightsail, Cloudflare Tunnel)
