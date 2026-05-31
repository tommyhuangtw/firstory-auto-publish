# Task #18：社群爬蟲工具研究 — 讓小企掌握即時社群風向

## 摘要

本研究調查四大平台（X/Twitter、Threads、Reddit、YouTube/Podcast）的社群趨勢監控工具，為小企（Content Strategist）建立基於真實社群討論的提案能力。研究涵蓋官方 API、Apify actors、開源工具、第三方服務的成本與可行性比較，並設計資料注入小企 context 的整合機制。

**核心結論**：Reddit 官方 API（免費）+ YouTube RSS + Threads Keyword Search API 是成本最低、最穩定的組合，每月預估成本低於 $15 USD。

---

## 目錄

1. [X (Twitter) 平台](#1-x-twitter-平台)
2. [Threads 平台](#2-threads-平台)
3. [Reddit 平台](#3-reddit-平台)
4. [YouTube / Podcast 頻道監控](#4-youtube--podcast-頻道監控)
5. [成本比較總覽](#5-成本比較總覽)
6. [推薦方案與優先順序](#6-推薦方案與優先順序)
7. [資料注入小企 Context 的機制設計](#7-資料注入小企-context-的機制設計)
8. [POC 建議](#8-poc-建議)
9. [監控目標清單](#9-監控目標清單)
10. [Takeaways 與後續行動](#10-takeaways-與後續行動)

---

## 1. X (Twitter) 平台

### 1.1 官方 X API

2026 年 X 已將新開發者預設改為 **pay-per-use** 模式，舊版分級制僅對既有訂閱者開放。

| 方案 | 月費 | 推文讀取 | 重點限制 |
|------|------|----------|----------|
| Pay-per-use（新默認）| 無月費 | $0.005/篇（上限 2M/月）| 無 streaming、無全歷史搜尋 |
| Basic（已停賣）| $200/mo | 15,000/mo | 基礎搜尋，1 個 app |
| Pro（已停賣）| $5,000/mo | 1,000,000/mo | Filtered stream、全歷史搜尋 |
| Enterprise | ~$42,000/mo | 協商 | Firehose 存取 |

**結論**：官方 API 對本專案來說**成本過高**。Hashtag 即時監控需要 Pro 級（$5,000/mo）以上才有 streaming 和全歷史搜尋。Pay-per-use 方案連基本的 keyword streaming 都沒有。

### 1.2 Apify Actors（推薦替代方案）

| Actor | 定價 | 特色 |
|-------|------|------|
| **apidojo/tweet-scraper V2** | ~$0.15-0.25/千篇 | 最強搜尋運算符（`from:`, `since:`, `lang:`, `min_faves:`）|
| **kaitoeasyapi/twitter-x-data-tweet-scraper** | $0.25/千篇 | 預算選項 |
| **epctex/twitter-scraper** | 固定月費 | 無限推文 |

**成本估算**：監控 4 個 hashtag（#AIAgents, #LLM, #Claude, #MCP），每天 ~500 篇/hashtag = 60,000 篇/月 ≈ **$9-15/月**。

### 1.3 第三方服務

| 服務 | 定價 | 特色 |
|------|------|------|
| **TwitterAPI.io** | $0.15/千篇 | Drop-in 替代官方 API，1,000+ RPS |
| **RapidAPI（Old Bird V2）** | $179.99/mo（1M 篇）| 高流量方案 |

### 1.4 開源工具

| 工具 | 狀態 | 備註 |
|------|------|------|
| **Twikit** | 活躍（4.2K stars）| 免費，但需真實 X 帳號，可能被封號 |
| **snscrape** | 已死 | 3 年未更新，2026 年完全無法使用 |
| **Nitter** | 已死 | 2024 年 2 月宣布停止維護 |
| **twscrape** | 活躍 | 帳號池方式，Python |

**風險提醒**：所有開源爬蟲都逆向工程 X 的內部 API，每幾週就可能壞掉，且有帳號封停風險。不建議用於生產環境。

### 1.5 X 平台可取得的資料欄位

- **核心**：`id`, `text`, `created_at`, `author_id`, `lang`, `source`
- **互動指標**：`retweet_count`, `reply_count`, `like_count`, `quote_count`, `bookmark_count`, `impression_count`
- **附件**：`urls`, `hashtags`, `mentions`, `media`
- **作者資訊**：`username`, `followers_count`, `verified`, `location`

### 1.6 X 平台結論

| 排名 | 方案 | 預估月費 | 穩定性 | 維護成本 |
|------|------|----------|--------|----------|
| 1 | **Apify（apidojo/tweet-scraper V2）** | $10-30 | 高 | 低 |
| 2 | **TwitterAPI.io** | $9-15 | 高 | 低 |
| 3 | Twikit（開源）| 免費 | 中 | 高 |
| 4 | 官方 API（Pro）| $5,000 | 最高 | 低 |

**推薦**：Apify actor 或 TwitterAPI.io。Apify 的優勢是專案已有 `APIFY_API_TOKEN`，可直接整合。

---

## 2. Threads 平台

### 2.1 Threads 官方 API（Keyword Search）

Meta 於 2025 年推出 Threads Keyword Search API，是目前最乾淨的監控方式。

**端點**：`GET https://graph.threads.net/v1.0/keyword_search`

| 參數 | 說明 |
|------|------|
| `q` | 搜尋關鍵字（必填）|
| `search_type` | `TOP`（預設）或 `RECENT` |
| `search_mode` | `KEYWORD`（預設）或 `TAG` |
| `media_type` | 篩選 `TEXT`、`IMAGE`、`VIDEO` |
| `since` / `until` | Unix 時間戳範圍 |
| `limit` | 每頁結果數（預設 25，上限 100）|
| `author_username` | 精確使用者篩選 |

**回傳欄位**：`id`, `text`, `media_type`, `permalink`, `timestamp`, `username`, `has_replies`, `is_quote_post`, `is_reply`

**速率限制**：2,200 次查詢/24 小時（滾動窗口），零結果查詢不計入。

**需要權限**：`threads_basic` + `threads_keyword_search`。未經 Meta 審核通過的 app 只能搜尋自己的貼文。

**重要**：本專案已有 Threads OAuth 整合（`THREADS_APP_ID`, `THREADS_APP_SECRET`），可在此基礎上申請 `threads_keyword_search` 權限。

### 2.2 Apify Actors

| Actor | 定價 | 特色 |
|-------|------|------|
| **futurizerush/threads-keyword-search** | ~$0.60/千篇 | 專注關鍵字搜尋，含互動指標 |
| **automation-lab/threads-scraper** | ~$4.00/千篇 | Profile + Posts + Search |
| **pro100chok/threads-scraper-usage** | $2.00/千篇 或 $20/月 | 全功能 |

### 2.3 開源工具

| 工具 | 來源 | 備註 |
|------|------|------|
| **threads-api (Danie1)** | PyPI | 非官方 Python client，需登入 |
| **Threads-Scraper (Zeeshanahmad4)** | GitHub | 不需登入，公開資料 |
| **EnsembleData** | API 服務 | 不需登入，公開資料 |

### 2.4 Threads 平台結論

**首選**：官方 Keyword Search API（免費、穩定、合法）。本專案已有 Threads OAuth 設定，只需申請 `threads_keyword_search` 權限。每天搜尋 10 個關鍵字 × 4 次 = 40 次查詢/天，遠低於 2,200/天的限制。

**備選**：如果 Meta 審核未通過或等待期太長，使用 Apify `futurizerush/threads-keyword-search`（$0.60/千篇）。

---

## 3. Reddit 平台

### 3.1 Reddit 官方 API（推薦首選）

2023 年 API 改革後，Reddit 仍保留免費方案給非商業用途：

| 方案 | 月費 | 速率限制 | 適用對象 |
|------|------|----------|----------|
| **免費**（非商業）| $0 | 100 req/min（OAuth）| 個人/研究/開源 |
| 無認證 | $0 | 10 req/min | `.json` suffix trick |
| 商業 | $0.24/千次 | 100-500 req/min | 營利應用 |

**重點端點**：

| 端點 | 用途 |
|------|------|
| `/r/{subreddit}/hot` | 當前熱門貼文 |
| `/r/{subreddit}/top?t=day` | 每日最高分貼文 |
| `/r/{subreddit}/rising` | 快速上升中的貼文 |
| `/search?q={query}` | 跨版搜尋 |
| `/comments/{post_id}` | 留言串 |

**認證設定**（2 分鐘）：
1. 到 `reddit.com/prefs/apps` 建立 "script" 類型 app
2. 取得 Client ID + Client Secret
3. OAuth2 password grant flow 取得 access token

### 3.2 Node.js / TypeScript 工具

| 工具 | 備註 |
|------|------|
| **snoowrap** | JS Reddit API wrapper，有 TypeScript 型別，自動 rate limit |
| **Snoostorm** | 基於 snoowrap 的事件驅動 streaming，TypeScript |
| **直接 fetch()** | Reddit REST API 很簡單，直接呼叫也很可行 |

### 3.3 Apify Actors

| Actor | 定價 |
|-------|------|
| **crawlerbros/reddit-scraper** | $3.40/千篇 |
| **practicaltools/fast-reddit-scraper** | $2.00/千篇 |
| **automation-lab/reddit-scraper** | ~$1.00/千篇 |

### 3.4 `.json` Suffix Trick（最簡方案）

直接在 Reddit URL 後加 `.json`，無需任何認證：
```
https://www.reddit.com/r/MachineLearning/hot.json
```
- 10 req/min（IP-based）
- 足夠每 30 分鐘檢查 6 個 subreddit（= 12 次請求）

### 3.5 Reddit 可取得的資料欄位

```typescript
interface RedditPost {
  id: string;
  title: string;           // 貼文標題
  selftext: string;        // 內文
  author: string;
  score: number;           // upvotes - downvotes
  upvote_ratio: number;    // e.g., 0.95
  num_comments: number;
  created_utc: number;     // Unix timestamp
  url: string;
  permalink: string;
  subreddit: string;
  link_flair_text: string | null;  // 分類標籤
}
```

### 3.6 Reddit 平台結論

| 排名 | 方案 | 預估月費 | 穩定性 |
|------|------|----------|--------|
| 1 | **官方 API（免費方案 + snoowrap/fetch）** | $0 | 高 |
| 2 | `.json` suffix（零設定）| $0 | 中 |
| 3 | Apify actors | $1-3/千篇 | 中 |

**推薦**：官方 Reddit API 免費方案。設定簡單（2 分鐘），100 req/min 完全足夠，且長期穩定。直接用 `fetch()` 呼叫 REST API 即可，不需額外依賴。

---

## 4. YouTube / Podcast 頻道監控

### 4.1 YouTube Data API v3（已整合）

本專案已使用 YouTube Data API（`youtube.ts`, `youtubeKeys.ts`），有 key rotation 機制。

| 端點 | Quota 成本 | 用途 |
|------|-----------|------|
| `search.list` | **100 units** | 關鍵字搜尋（昂貴！）|
| `channels.list` | 1 unit | 頻道資訊 |
| `playlistItems.list` | 1 unit | 上傳播放清單（代替 search）|
| `videos.list` | 1 unit | 影片詳細資料 |

**每日 quota**：10,000 units（免費）

**低成本監控策略**：使用 uploads playlist 而非 search：
1. `channels.list` 取得 uploads playlist ID（1 unit）
2. `playlistItems.list` 取得近期影片（1 unit/頁，50 筆）
3. `videos.list` 取得觀看次數（1 unit/批，50 筆）

**成本**：30 個頻道/天 ≈ 90 units/天（佔 quota 不到 1%）

### 4.2 YouTube RSS（免費、零 quota）

每個公開頻道都有 RSS feed：
```
https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID}
```

**可取得**：影片標題、URL、發布日期、縮圖、簡短描述
**無法取得**：觀看數、按讚數、時長、完整描述、標籤

**限制**：只回傳最近 15 支影片。

**推薦策略**：RSS 作為第一層偵測（免費），API 作為第二層補充（低 quota 消耗）。

### 4.3 Podcast 監控

| 工具 | 免費方案 | 付費 | 適用場景 |
|------|----------|------|----------|
| **Listen Notes API** | 300 req/mo | $200/mo（Pro）| 最大 podcast 搜尋引擎（3.7M+ podcasts）|
| **Podcast RSS feeds** | 免費 | — | 直接監控已知 podcast 的 RSS |
| **Podchaser** | 企業定價 | 自訂 | 排行榜、聽眾分析 |

**推薦**：直接用 RSS 監控已知的 AI podcast（免費），不需要 Listen Notes API。

### 4.4 推薦監控的 AI YouTube 頻道

#### Tier 1：高頻 AI 新聞（每日/近每日更新）
| 頻道 | 訂閱數 | 重點 |
|------|--------|------|
| Matthew Berman | ~540K | 開源模型、LLM 比較 |
| Fireship | 3M+ | 快速技術解說 |
| Matt Wolfe | 800K+ | AI 工具評測、FutureTools.io |
| Wes Roth | ~313K | AI 新聞評論 |
| TheAIGRID | ~300K+ | AI 新聞彙整 |

#### Tier 2：深度分析（每週/雙週）
| 頻道 | 訂閱數 | 重點 |
|------|--------|------|
| AI Explained | ~400K | 研究導向分析 |
| Two Minute Papers | 1.5M | ML 論文摘要 |
| Yannic Kilcher | 250K+ | 論文評論 |

#### Tier 3：長篇訪談
| 頻道 | 訂閱數 | 重點 |
|------|--------|------|
| Lex Fridman | 4.5M+ | AI 研究者訪談 |
| Andrej Karpathy | 500K+ | 深度技術教育 |

**趨勢偵測策略**：當多個 Tier 1 頻道在 24-48 小時內都覆蓋同一主題，即為強烈趨勢信號。

---

## 5. 成本比較總覽

### 各平台推薦方案月費估算

| 平台 | 推薦方案 | 預估月費 | 備註 |
|------|----------|----------|------|
| **Reddit** | 官方 API（免費）| **$0** | 100 req/min，完全足夠 |
| **YouTube** | RSS + Data API | **$0** | 已有 API key，quota 充裕 |
| **Threads** | 官方 Keyword Search API | **$0** | 已有 OAuth 設定，需申請權限 |
| **X (Twitter)** | Apify tweet-scraper V2 | **$10-15** | 60K 篇/月 |
| **LLM 分析** | OpenRouter（Gemini Flash）| **$1-3** | 每日摘要生成 |

### 總預估月費：**$11-18/月**

### 最低成本方案（Phase 1）

若只啟用免費方案：
- Reddit `.json` trick：$0
- YouTube RSS：$0
- Threads（等待 API 審核）：$0

**Phase 1 月費：$0**

---

## 6. 推薦方案與優先順序

### Phase 1（立即可做，$0）— Reddit + YouTube RSS

1. **Reddit**：用官方 API 免費方案（或 `.json` suffix trick）
   - 每 30 分鐘抓取 6-8 個 AI subreddit 的 hot/top 貼文
   - 目標：r/MachineLearning, r/LocalLLaMA, r/ChatGPT, r/ClaudeAI, r/artificial, r/singularity
   - 實作：直接 `fetch()` 呼叫，不需額外套件

2. **YouTube**：RSS feed 監控
   - 每 60 分鐘輪詢 30 個 AI 頻道的 RSS feed
   - 偵測新影片上傳 → 用已有的 YouTube API 補充觀看數
   - 可用 n8n 或 cron job 實作

### Phase 2（申請後啟用，$0）— Threads

3. **Threads**：官方 Keyword Search API
   - 申請 `threads_keyword_search` 權限（專案已有 OAuth）
   - 每天搜尋 10 個 AI 相關關鍵字

### Phase 3（按需啟用，$10-15/月）— X/Twitter

4. **X/Twitter**：Apify actor 或 TwitterAPI.io
   - 只在 Reddit + YouTube 趨勢偵測不足時才啟用
   - X 的獨特價值：即時性最強，但成本也最高

---

## 7. 資料注入小企 Context 的機制設計

### 方案：定期生成 `trend-briefing.md`

```
┌───────────────┐     ┌──────────────┐     ┌──────────────┐
│  Cron Job     │────►│  Fetch Data  │────►│  LLM 摘要    │
│  每 6-12 小時 │     │  Reddit/YT/  │     │  生成 trend  │
│               │     │  Threads/X   │     │  briefing    │
└───────────────┘     └──────────────┘     └──────┬───────┘
                                                   │
                                                   ▼
                                          ┌──────────────┐
                                          │  寫入檔案     │
                                          │  trend-       │
                                          │  briefing.md  │
                                          └──────┬───────┘
                                                   │
                                    ┌──────────────┼──────────────┐
                                    ▼              ▼              ▼
                             Hermes context   小企 context   Knowledge Base
```

### trend-briefing.md 格式設計

```markdown
# AI 社群趨勢速報
**更新時間**: 2026-05-28 22:00 UTC+8
**資料來源**: Reddit (6 subreddits), YouTube (30 channels), Threads

## 🔥 本日熱門話題

### 1. [話題名稱]
- **熱度指標**: Reddit 3 篇 top post (avg score 500+), YouTube 5 支新影片
- **關鍵討論**: [摘要]
- **代表貼文/影片**: [連結]
- **Podcast 選題建議**: [一句話建議]

### 2. [話題名稱]
...

## 📊 平台趨勢快照

### Reddit 熱門
| Subreddit | 標題 | Score | 留言數 |
|-----------|------|-------|--------|
| r/LocalLLaMA | ... | 1234 | 456 |

### YouTube 新影片
| 頻道 | 標題 | 觀看數 | 發布時間 |
|------|------|--------|----------|
| AI Explained | ... | 50K | 2h ago |

### Threads 討論
| 使用者 | 內容摘要 | 互動數 |
|--------|----------|--------|
| @... | ... | 200 |

## 📅 近七日趨勢變化
[LLM 生成的趨勢分析]
```

### 整合方式

1. **Hermes Context**：trend-briefing.md 自動載入為 Hermes 的 context 檔案，讓 Hermes 在每日 morning briefing 中引用
2. **Knowledge Base**：存入 `dashboard/data/research/` 目錄，自動索引到 `knowledge_docs` table
3. **Pipeline 注入**：可選擇在 `scriptEnglish` node 中將趨勢摘要注入 LLM prompt，讓腳本更即時
4. **Telegram 推送**：透過 Hermes webhook 在趨勢突變時推送 Telegram 通知

### 技術實作建議

```typescript
// scripts/social-trend-monitor.ts
// 可作為 cron job 或 n8n workflow 觸發

interface TrendData {
  reddit: RedditTrend[];
  youtube: YouTubeTrend[];
  threads: ThreadsTrend[];
  twitter?: TwitterTrend[];  // Phase 3
}

interface RedditTrend {
  subreddit: string;
  title: string;
  score: number;
  num_comments: number;
  url: string;
  created_utc: number;
}

// 1. Fetch data from all platforms
// 2. Deduplicate & cluster by topic (LLM)
// 3. Generate trend-briefing.md
// 4. Write to dashboard/data/research/trend-briefing-{date}.md
// 5. Notify via Hermes webhook if significant trends detected
```

---

## 8. POC 建議

### 推薦 POC：Reddit 趨勢監控

**為什麼選 Reddit**：
- 完全免費（官方 API）
- 設定最簡單（2 分鐘註冊 app）
- 資料品質最高（長文討論、技術深度）
- TypeScript 直接 `fetch()` 就能做，不需額外依賴
- AI 社群在 Reddit 上最活躍（r/LocalLLaMA, r/MachineLearning 等）

**POC 範圍**：
1. 註冊 Reddit "script" app，取得 Client ID/Secret
2. 寫 `scripts/poc-reddit-trends.ts`
3. 每次抓取 6 個 subreddit 的 top 25 hot posts
4. 用 LLM（透過已有的 `llmService`）摘要出 Top 5 趨勢
5. 輸出 `trend-briefing.md` 到 `data/research/`

**預估工作量**：約 200 行 TypeScript 程式碼。

### 備選 POC：YouTube RSS

如果不想設定 Reddit API，YouTube RSS 是另一個零設定的選擇：
- 不需任何 API key
- 用 `fetch()` 抓取 XML → 解析 → LLM 摘要
- 可監控已知的 AI 頻道清單

---

## 9. 監控目標清單

### Reddit Subreddits
| Subreddit | 訂閱數 | 重點 | 更新頻率 |
|-----------|--------|------|----------|
| r/MachineLearning | 3M+ | 學術 ML、論文 | 高 |
| r/LocalLLaMA | 500K+ | 開源 LLM、量化 | 極高 |
| r/ChatGPT | 5M+ | ChatGPT 使用、新聞 | 極高 |
| r/ClaudeAI | 100K+ | Claude 專屬討論 | 中 |
| r/artificial | 300K+ | 通用 AI 新聞 | 中 |
| r/singularity | 800K+ | AGI、AI 影響 | 高 |
| r/OpenAI | — | OpenAI 產品討論 | 中 |
| r/Anthropic | — | Anthropic/Claude 生態 | 中 |

### X/Twitter Hashtags 與帳號
| 目標 | 類型 |
|------|------|
| #AIAgents | Hashtag |
| #LLM | Hashtag |
| #Claude | Hashtag |
| #MCP | Hashtag |
| #AITools | Hashtag |
| @AnthropicAI | 帳號 |
| @OpenAI | 帳號 |
| @GoogleDeepMind | 帳號 |
| @xaborai | 帳號 |

### Threads 關鍵字
`AI tools`, `ChatGPT`, `Claude`, `Gemini`, `AI agent`, `LLM`, `prompt engineering`, `MCP`, `AI automation`, `open source AI`

### YouTube 頻道（詳見 4.4 節）
30 個 AI 頻道，分三個 Tier。

### Podcast RSS
| Podcast | RSS Feed |
|---------|----------|
| Lex Fridman | `https://lexfridman.com/feed/podcast/` |
| Practical AI | `https://changelog.com/practicalai/feed` |
| The TWIML AI Podcast | 可查 |
| Latent Space | 可查 |

---

## 10. Takeaways 與後續行動

### 核心發現

1. **Reddit 是最有價值的免費資源**：官方 API 免費、AI 社群活躍、討論深度高、TypeScript 整合簡單
2. **YouTube RSS 是零成本監控利器**：不消耗 API quota，可偵測新影片上傳，搭配 API 補充數據
3. **Threads 有官方 Keyword Search API**：本專案已有 OAuth 設定，申請權限即可使用
4. **X/Twitter 成本最高、價值遞減**：除非需要即時性，否則 Reddit + YouTube 已能覆蓋大部分 AI 趨勢
5. **Apify 是萬用備案**：專案已有 `APIFY_API_TOKEN`，任何平台都有對應的 actor

### 後續行動建議

- [ ] **立即**：實作 Reddit 趨勢監控 POC（`scripts/poc-reddit-trends.ts`）
- [ ] **短期**：設定 YouTube RSS 監控（可用 n8n 或 cron）
- [ ] **短期**：申請 Threads `threads_keyword_search` 權限
- [ ] **中期**：實作 `social-trend-monitor.ts` 整合所有平台
- [ ] **中期**：設計 `trend-briefing.md` 自動生成流程
- [ ] **按需**：啟用 X/Twitter Apify actor
- [ ] **按需**：將 trend-briefing 注入 Hermes context 與 pipeline prompt

---

*研究完成時間：2026-05-28*
*資料來源：X API 官方文檔、Meta Threads API 文檔、Reddit API 文檔、YouTube Data API 文檔、Apify Store、多個第三方工具評測*
