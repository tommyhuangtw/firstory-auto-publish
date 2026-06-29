# 設計：`/resources` 學習資源策展

> 把 n8n 的「每天爬社群學習資源 → AI 評分 → 生 Threads 草稿 → 寄 email 審核」流程
> 遷進 dashboard，做得更彈性，並解決「GitHub 老 repo 一直被撈進來」的問題。

- **日期**：2026-06-29
- **分支**：`feat/resources-curation`
- **狀態**：設計定稿，待 spec review → 進實作計畫

---

## 1. 目標與動機

**受眾**：正在用 Claude Code / Codex / AI coding agent 的開發者與獨立創作者。
他們愛看**免費、高品質、能立刻上手的實用資源**（工具、repo、教學、課程、技巧）。

**現有 n8n 流程的痛點**：
- 用 GitHub 當「發現來源」（搜 `created:>` 幾乎永遠回空、搜 `stars:>` 撈到的是已經穩定 3+ 個月、沒話題的老東西）。
- 沒有持久去重 → 天天重發同一個 awesome-list。
- 生文/審核都在 n8n，語氣跟 dashboard 既有的 voice writer 不一致。

**這個 feature 要達成**：
1. 只浮出**現在正在被討論 / 正在長**的資源；老而靜的自動沉底。
2. 資源不限 GitHub —— 從 X/Reddit 看到任何用戶會想要的免費好資源都記錄。
3. 每天自動產 Top N Threads 草稿（用 Tommy 經驗證的 voice writer 架構），寄 email + 上 `/resources` 頁 review/編輯/發布。
4. 可**一鍵手動觸發**整個流程，不必等排程。

**成功標準**：
- 連跑數天，GitHub 老 repo（>3 月、星數平、無社群討論）不再出現。
- 每天 email 收到 Top N 資源 + 可用草稿。
- `/resources` 頁可 review、編輯草稿、複製 / 深連去 Threads 發布。
- `npm run build` 綠；一鍵手動跑能完整跑完一輪並看到 funnel 數據。

---

## 2. 核心架構翻轉：社群當「雷達」，GitHub 當「資料庫」

把 n8n 的因果倒過來 —— **不再用 GitHub 當主要發現來源**：

```
發現層（誰在被討論）              驗證/補料層                   產出層
┌──────────────────────┐      ┌────────────────────┐      ┌──────────────┐
│ X / Reddit 爬討論      │──提取─→│ GitHub API 補資料   │──→ 評分 → Top N    │
│  · 高互動貼文           │ repo │  star / desc / age   │      │ → 生草稿      │
│  · 抽出被提到的 repo/工具│ 名稱 │  + 星數快照 delta     │      │ → email      │
│  · 貼文本身就是好資源就直接收│      └────────────────────┘      │ → /resources │
└──────────────────────┘                  ↑                  └──────────────┘
┌──────────────────────┐                  │
│ GitHub 獨立掃          │──新生 repo────────┘
│  topic:mcp/ai-agent…   │   (pushed 近期 + 星暴衝)
│  pushed:>近期 + 星門檻   │
└──────────────────────┘
```

- **老 repo 沒人在 X/Reddit 討論、星數又平 → 永遠不會浮上來。** 這正是要的。
- **資源不限 repo**：一條分享免費課程的爆文、一個工具網站、一篇教學 thread —— 只要對受眾有用就收。

---

## 3. 資源模型（通用，不綁 GitHub）

一個「resource」可以是任何值得分享的東西。`content_type ∈ { github, x, reddit, link }`。

| 欄位 | 說明 |
|------|------|
| `guid` | 唯一鍵：`github_<owner/repo>` / `x_<tweetId>` / `reddit_<id>` / `link_<hash(url)>` |
| `content_type` | github / x / reddit / link |
| `title`, `description`, `url`, `author` | 通用 metadata |
| `published_at` | 原始發布時間（repo created_at / 貼文時間） |
| `stars`, `last_stars`, `last_stars_at` | **僅 github 類有效**，用來算星速度 |
| `social_buzz` | 近 N 天社群提到次數 × 互動的合成分 |
| `freshness_score` | gate 用（見 §4） |
| `ai_score`, `ai_reasoning`, `ai_highlights`, `ai_angle` | LLM 評分結果 |
| `first_seen_at` | 第一次被本系統看到（去重/re-surface 用） |
| `last_surfaced_at` | 最後一次浮上 Top N 的時間 |
| `status` | new / surfaced / drafted / dismissed |

星數欄位對非 github 類留 NULL；那些資源的「新鮮度」來自貼文自身互動 + recency。

---

## 4. Freshness Gate（解 stale-GitHub 的核心）

每個候選資源算 `freshnessScore`，**必須通過硬閘門**才進 LLM 評分。

### 訊號

| 訊號 | 適用 | 邏輯 |
|------|------|------|
| `socialBuzz` | 全部 | X/Reddit 近 N 天被提到的次數 × 互動（讚+回+轉）。貼文原生資源＝它自己的互動。 |
| `starVelocity` | github | 自存星數快照算 stars/day（本次星數 − `last_stars`）/(天數)。 |
| `youthBonus` | github | `created_at` 距今越近越高；>~60 天後快速衰減。 |

### 硬閘門

```
通過 = socialBuzz > buzzFloor                      // 有人在討論
     OR starVelocity > velocityFloor               // 星星正在暴衝
     OR (content_type 非 github 且 貼文互動 > 門檻)  // 社群原生好資源
```

兩條社群訊號 + 星速度都不過 → **淘汰**（老而靜）。

**最高分組合** = 新生 repo（幾天～2 個月）+ 星速度暴衝 → youthBonus × starVelocity 疊加，排序最前。

**星數快照**：首次看到的 repo 沒有 `last_stars` 歷史 → 用 youthBonus 兜底（新 repo 本身就是訊號）；隔天起就有 delta 可算。

門檻（`buzzFloor` / `velocityFloor` / `youth 窗口`）全部走 `settings` 表，可在不改 code 下調。

---

## 5. 持久去重 + re-surface 記憶（解「已經在那很久」）

- `curated_resources` 表以 `guid` 唯一。每個資源記 `first_seen_at`。
- **只在「新動能」時 re-surface**：已 surface 過的，除非
  - 星速度**再次加速**（delta 比上次明顯放大），或
  - 出現**新一波社群討論**（socialBuzz 重新越過門檻），
  否則不重複推上 Top N。直接擋掉「天天重發同一個 awesome-list」。

---

## 6. Pipeline（仿 `/trends` 的 crawl→score 骨架）

新模組 `src/services/resources/`，每天排程跑、也可一鍵手動觸發。6 個 stage：

```
1. crawl        X / Reddit / GitHub 平行爬（Apify for X；Reddit OAuth/HTTP；GitHub API）
2. extract      從 X/Reddit 高互動貼文抽出 repo URL / 工具名 / 外部好資源連結
3. enrich       repo → GitHub API 補 star/desc/created_at + 星數快照 delta
4. freshnessGate 硬閘門（§4），淘汰老而靜；非 github 原生資源走互動門檻
5. score        LLM 評分（沿用 n8n rubric：實用性35/契合度30/新穎性20/收藏15）
6. topN + draft voice/writer.ts best-of-N 生 Top N 草稿 → notify
```

- 每次跑存 `resource_scan_runs` audit row：`scraped / belowFloor(gate) / stale / deduped / recorded`（沿用 trends 的 funnel 記錄法）。
- Fire-and-forget：手動觸發 API 立即回傳，背景跑。

### 模組檔案

| 檔案 | 職責 |
|------|------|
| `resources/types.ts` | RawResource / EnrichedResource / ScoredResource / ScanResult |
| `resources/crawler.ts` | Apify(X) + Reddit + GitHub 爬取，回統一 RawResource[] |
| `resources/extract.ts` | 從社群貼文抽 repo/連結/工具名 |
| `resources/enrich.ts` | GitHub API 補料 + 星數快照 delta |
| `resources/freshness.ts` | freshnessScore + 硬閘門 + re-surface 判斷 |
| `resources/scorer.ts` | LLM 評分（rubric） |
| `resources/draft.ts` | 包 voice/writer.ts 生資源型草稿 |
| `resources/pipeline.ts` | orchestrator（6 stage + audit log） |
| `resources/digest.ts` | 組 email HTML + 寄送 |

---

## 7. 草稿生成 + 語氣

- 用 **`voice/writer.ts`**（best-of-N + 爆文 predictor），**不是** trends 的 brandVoice 單發 —— 因為要「整合經過驗證的架構」。
- 語氣調成「懶人包／工具清單」感，但仍走 Tommy 個人口吻 asset。
- Top N 各生一篇，每篇 best-of-5 挑最爆；predictor 服務離線時 graceful fallback（沿用既有行為）。
- 草稿內含來源 URL。

---

## 8. Review UI + 發布路徑

`/resources` 頁面，**卡片式**（資源型，不是熱點貼文樣）：

每張卡：
- **資源本體**：標題、`content_type` badge、（github）star 數 + **本期 star delta** + repo 年齡、來源連結、**為什麼現在熱**（社群討論 / 星暴衝 標籤）。
- **AI 草稿**（可內聯編輯）+ 爆文分數 + AI 推薦理由/亮點。
- **按鈕**：`📋 複製` ＋ `🧵 去 Threads 發佈`（深連到 Threads compose 頁，在那編輯）。**不接 API 自動發**（跟現有流程一致，Tommy 完全控制）。
- `❌ 不要` → status=dismissed。

**頂部**：`▶️ 立即執行` 按鈕（一鍵手動跑）+ 顯示最後一次 run 的 funnel（scraped→gate→recorded）+ 執行中狀態。

**nav 紅點**：沿用 `/api/trends/niche/unread` 那套 unseen 機制，新資源到了亮紅點，點進去即清。

### API routes（`src/app/api/resources/`）

| route | 用途 |
|-------|------|
| `POST /api/resources/scan` | fire-and-forget 一鍵觸發 pipeline |
| `GET /api/resources` | 列出資源 + 草稿（review 頁用） |
| `GET /api/resources/scans` | 最近 run 的 funnel（狀態列） |
| `PATCH /api/resources/[id]` | 編輯草稿 / dismiss |
| `GET /api/resources/unread` | nav 紅點 |

---

## 9. Email Digest

- 每天爬完用 `gmail.ts` 寄一封 HTML（仿 n8n 那封）：Top N 資源 + AI 草稿 + 為什麼現在值得看 + 來源連結。
- 寄給 `RECIPIENT_EMAIL`。
- 手動觸發跑完也寄（讓「爬出來的內容丟到 email」這個硬需求在任何觸發路徑都成立）。

---

## 10. 排程

- `scheduler.ts` 加一個每天的 job（沿用現有 node-cron 機制），呼叫 `runResourceScan()`。
- 與一鍵手動觸發共用同一個 pipeline 入口。

---

## 11. 資料表（`src/db/index.ts` 走 safeAlter/safeIndex，仿 trend 表）

- `curated_resources`（§3 欄位）
- `resource_drafts`（draft_text / score / status / resource guid 外鍵）
- `resource_scan_runs`（audit：started/finished/duration + funnel 計數 + dropped JSON）

索引：`guid` unique、`status`、`scan_run_id`。

---

## 12. 復用對照（新 vs 接現有零件）

| 需要的能力 | 來源 |
|------------|------|
| crawl→score→audit 骨架 | 仿 `services/trends/pipeline.ts` |
| 草稿語氣（best-of-N + predictor） | **復用** `services/voice/writer.ts` |
| Email 寄送 | **復用** `services/gmail.ts` |
| 排程 | **復用** `services/scheduler.ts` |
| nav 紅點 unseen | **復用** `/api/trends/*/unread` 模式 |
| 表 migration | **復用** `db/index.ts` safeAlter 模式 |
| Apify 爬 X | **復用** n8n 用的 Apify twitter scraper（token 走 env） |
| 新寫 | resources/ 模組（crawler/extract/enrich/freshness/scorer/draft/pipeline/digest）、`/resources` 頁、API routes、3 張表 |

---

## 13. 不做（YAGNI）

- **不爬 YouTube**（這版砍掉）。
- **不接 Threads API 自動發**（深連 + 複製已足）。
- **不做 Telegram 審核按鈕**（email + 頁面已夠）。
- **不追 X 人物八卦帳號**（跟資源流牴觸，n8n 那條砍掉）。
- **不做語意/向量去重**（guid 去重已足；要再說）。
- **不做品質重寫迴圈**（best-of-N 已是篩選機制）。

---

## 14. 風險 / 待驗

- **Apify X 成本**：按量計費；用 query 數 + maxItems 控制，門檻走 settings。
- **星速度首日無歷史**：靠 youthBonus 兜底，隔日起準確。
- **extract 抽 repo 準確度**：從貼文抽 repo URL 直接可靠；抽「工具名」較模糊 → 第一版只信 URL，工具名當輔助關鍵字餵 GitHub 搜尋。
- **freshness 門檻調校**：上線後看 funnel 數據迭代（全走 settings，不改 code）。
