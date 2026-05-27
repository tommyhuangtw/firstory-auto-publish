# n8n Threads Content Curation Pipeline

## Overview
每天 8am 自動從 4 個來源收集 AI 相關內容，AI 評分後生成 Threads 貼文草稿。

## Pipeline Flow
```
Trigger (8am daily)
  → 4 parallel sources:
    ├── YouTube (14 queries × 5 results, 30hr window)
    ├── Reddit (4 subreddit groups, weekly top)
    ├── GitHub (3 topic queries, 6.25 day window)
    └── X/Twitter (20 search terms via Apify, 1.5 day)
  → Merge all sources
  → Dedup against DataTable (existing GUIDs)
  → Engagement filter (YT≥12k views, Reddit≥150 score, GitHub≥150 stars)
  → AI Scoring (Gemini 3.1 Flash Lite, 4 dimensions × 25 pts)
  → Extract Top 5 (worthSharing=true, sorted by score)
  → YouTube transcript fetch (Apify, top 5 only)
  → AI Post Generation (Gemini 3 Flash, 繁體中文 Threads 貼文)
  → Email review (Gmail with approve buttons)
  → DataTable cleanup (keep latest 60 records)
```

## Scoring Dimensions
1. 新穎性 (Novelty) — 0-25 分
2. 實用性 (Usefulness) — 0-25 分
3. 傳播力 (Virality) — 0-25 分
4. 適合度 (Fit) — 0-25 分
- 加分：免費/開源 +6, 知名公司 +4
- 扣分：廣告感 -6, 高額訂閱 -5
- Total ≥ 75 → worthSharing = true

## Known Issues (待修)
1. API keys 寫死在 workflow JSON → 改用 n8n credentials
2. YouTube API URL 少了 /youtube/ path
3. 時間窗口不一致 (YT 30hr vs Reddit 7天)
4. 低流量 subreddits (OpenClaw, free_ai_resource)
5. Cleanup 邏輯名稱與實際不符 (50 vs 60)

## Hermes Integration
- Hermes 用 n8n_trigger_threads_curation tool 觸發
- 需要在 n8n workflow 加 webhook trigger node
- 結果透過 webhook 回傳 Hermes → Telegram
