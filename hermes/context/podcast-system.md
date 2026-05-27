# AI 懶人報 Podcast Automation — System Context

## Overview
全自動 Podcast 產製系統。從 YouTube 影片搜尋、AI 腳本生成、TTS 語音合成、到多平台發布。
Tech: Next.js 14 + TypeScript + LangGraph + SQLite (WAL mode)
Dashboard: http://localhost:3000

## Pipeline Stages (13-stage LangGraph)
```
fetchYoutube → classify → scriptEnglish → extractTools → translate
→ customContentInsert → scoreQuality → generateMeta → generateCover
→ synthesizeTts → generateSubtitles → uploadAssets → notify → END
                                                        ↓
                                             [暫停：pending_review]
                                                        ↓
                                                  publish (approve 後)
```

## Segment Types
| Type | 說明 | 頻率 |
|------|------|------|
| daily | 每日 AI 工具精選 | Mon/Wed/Fri/Sat |
| weekly | 每週 AI 精選週報 | Sunday |
| robot | 機器人觀察週報 | Thursday |
| sysdesign | 系統設計懶懶學 | 手動 |
| quickchat | 懶懶碎碎念 | 手動 |

## Episode Lifecycle
generating → pending_review → approved → publishing → published
                           ↘ rejected

## Key API Endpoints
| Endpoint | Method | 用途 |
|----------|--------|------|
| /api/pipeline/start | POST | 啟動 pipeline (segmentType, manualVideoUrls) |
| /api/pipeline/status | GET | 列出所有 pipeline runs |
| /api/pipeline/retry | POST | 從指定階段重試 |
| /api/episodes | GET | 列出 episodes (可篩 status/segment) |
| /api/episodes/:id/approve | POST | 審核通過 → 觸發多平台發布 |
| /api/episodes/:id/reject | POST | 駁回 |
| /api/scheduler/status | GET | 排程狀態 |
| /api/scheduler/trigger | POST | 手動觸發排程 |
| /api/metrics | GET | 成本/品質指標 |
| /api/analytics | GET | SoundOn 下載數據 |

## Publishing Platforms
1. SoundOn — Playwright 自動化登入上傳
2. YouTube — 影片 + 縮圖 + SRT 字幕
3. Instagram — 封面圖 + 文案 (Graph API)
4. Facebook — 封面圖 + 貼文 (Graph API)
5. Threads — 文字貼文 (Threads API)

## Quality & Cost
- 品質評分 < 85 分自動重寫 (最多 2 次)
- LLM 成本追蹤在 llm_calls 表
- 服務成本追蹤在 service_costs 表
- 每集總成本在 episodes.total_cost_usd

## Database Tables (19)
Core: episodes, pipeline_runs, pipeline_snapshots, llm_calls, service_costs
Sources: youtube_sources, weekly_youtube_sources, robot_youtube_sources
Memory: tools, tool_families, episode_tool_mentions
Config: settings, sponsor_audio_presets, ad_presets
Analytics: platform_analytics, soundon_daily_downloads, soundon_episodes
