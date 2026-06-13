# AI 懶人報 — Senior PM Product Review & 內容策略進化計畫

> 日期：2026-06-02
> 作者：Claude Code（Senior PM 角色）
> 分類：growth, ops, content

---

## 一、產品現狀總覽

### 核心價值
AI 懶人報是一套**全自動 Podcast 產製系統**，從 YouTube 影片搜尋、AI 腳本生成、TTS 語音合成到多平台發布，全流程自動化，僅在發布前需人工審核。

- **累積集數**：297+ 集
- **內容類型**：4 種 segment（daily 日報 / weekly 週報 / robot 機器人週報 / sysdesign 系統設計）
- **發布平台**：5 個（SoundOn / YouTube / Instagram / Facebook / Threads）
- **Pipeline**：13-stage LangGraph state machine + human review gate
- **Agent 系統**：三 agent 協作（小企提案 → 懶懶評估 → 小工執行）
- **排程**：每週 4-5 集 daily + 1 集 weekly + 1 集 robot

### 架構優勢（做得好的地方）

1. **State Snapshot + Retry**：Pipeline 任何階段失敗都可以從該階段重試，不用從頭跑
2. **Fire-and-Forget Publishing**：5 個平台獨立發布，一個掛不影響其他
3. **Tool Memory System**：三層時間衰減記憶機制，避免內容重複，維持工具多樣性
4. **Human Review Gate**：自動化不等於無審核，品質把關設計正確
5. **Data-Driven Title Generation**：用 297 集的下載數據校準 6 種標題模式，比純 LLM 猜測有效
6. **Cost Tracking**：每集的 LLM + TTS + media 成本完全透明
7. **Notification Hub**：中央事件派發，Gmail + Hermes webhook 獨立不互阻
8. **Quality Refinement**：品質分數 < 85 自動重寫，最多 2 次

---

## 二、不合理的地方（問題分析）

### 問題 1：Analytics 是最大的盲區

目前只追蹤兩個數據源：SoundOn 下載數 和 YouTube 基本 stats。

**缺少的關鍵數據**：
- **跨平台歸因**：YouTube 觀看 → SoundOn 收聽 → IG 互動，三者之間完全沒有關聯。無法回答「哪個平台帶來最多新聽眾？」
- **Listener Retention**：不知道聽眾聽了多少就離開，無法判斷內容長度和節奏是否合適
- **Cohort Analysis**：不知道新聽眾 vs 舊聽眾的比例，無法判斷成長來源
- **Title Pattern 動態更新**：`generateMeta.ts` 裡的 6 種標題模式（+35%, +30% lift 等）是靜態寫死的，沒有持續校準機制，隨聽眾口味變化會過時
- **Content-Performance Attribution**：無法追蹤「哪種主題 / 哪種 segment type 的表現最好」

**影響**：沒有數據就沒有決策依據。所有的內容策略調整都是靠直覺，不是靠數據。

### 問題 2：發布策略缺乏差異化

5 個平台**同時發布、同一時間**，這不是最佳策略：

- **沒有最佳發布時間分析**：不同平台的流量高峰不同（IG 晚上 8-10 點、YouTube 下午 2-5 點），但系統不支援分時發布
- **內容同質化**：除了 caption 格式不同，每個平台的內容本質上是一樣的
- **Publish Retry 缺失**：如果 IG 發布失敗，需要整集重試，不能只重試失敗的平台
- **沒有 Preview**：approve 之前看不到「發出去在各平台會長什麼樣」

### 問題 3：Review 流程有瓶頸

- **單人審核 = 瓶頸**：所有內容都等 Tommy 一個人 approve。一天三集的 review 壓力很大
- **沒有 Batch Approval**：必須一集一集進去看、一集一集 approve
- **Quality Refinement 不透明**：自動重寫最多 2 次，但 UI 上看不到「重寫了幾次」「重寫前 vs 後的分數差異」

### 問題 4：Pipeline 的浪費

- **Retry 是破壞性的**：從 stage 5 重試會重跑 stage 5-13，即使 6-13 的輸出都是好的
- **沒有 Stage-level Metrics**：看不到哪些 stage 最慢、失敗率最高
- **13 個 Stage 全部 Sequential**：有些 stage 可以並行（例如 translate + extractTools）

### 問題 5：Agent 系統的 ROI 不明

- 沒有衡量 agent 提案的 approve rate 和 impact
- Research task 的產出沒有回饋到 pipeline 的內容策略
- Agent 系統的維護成本 vs 產出價值需要更好的追蹤

---

## 三、核心策略問題：內容來源正在枯竭

### 現狀

Daily segment 使用固定 25 個 YouTube query（如 "Top AI tools", "Claude", "ChatGPT", "AI automation" 等），每個 query 取 viewCount 最高的 4 支影片，篩選條件：
- 發布時間：2.5 天內
- 時長：≥ 300 秒
- 觀看：≥ 5,000
- 按讚：≥ 50
- 留言：≥ 20

### 問題

到 2026 年，AI 工具市場已從「每天冒出新工具」進入**整合與深化**階段：

1. **信噪比下降**：固定 query 撈到的影片品質和相關性越來越低，YouTube 觀看量本身就說明了需求下降
2. **內容同質化**：當所有 AI Podcast 都在報「今天又出了什麼新工具」，差異化消失
3. **Query 靜態化**：25 個 query 是人工設定的，沒有動態更新機制來追蹤真正的熱門話題

### 戰略判斷

**應該從「每日工具速報」轉向「品質優先 + 深度分析」的混合模式。**

---

## 四、內容策略進化方案

### Phase 1：Content Quality Gate（智慧發刊判斷）— 最優先

**目標**：Pipeline 啟動前，先評估今天的素材是否值得做成一集 Podcast。不值得就不發。

#### 1.1 新增 Content Worthiness 評估

在 `fetchYoutube` + `classify` 之後、`scriptEnglish` 之前，插入新的 evaluation stage。

**評估維度**：
1. 新聞價值（是真的新東西，還是舊聞重炒？）
2. 話題熱度（社群討論度、影片觀看趨勢）
3. 內容深度（有實測/分析，還是只是介紹？）
4. 與近期 episodes 的重複度（用 tool memory 比對）
5. 綜合素材品質分數

**門檻策略**：
| 分數 | 決策 | 動作 |
|------|------|------|
| ≥ 70 | `proceed` | 正常產製 daily episode |
| 50-69 | `merge_to_weekly` | 素材留著，合併到下次 weekly 週報 |
| < 50 | `skip` | 跳過，發 Telegram 通知「今天沒有值得發的內容」|

**效益**：
- 立刻減少低品質內容
- 降低 Tommy 的 review 壓力
- 提升每集的平均品質和聽眾期待值
- 減少不必要的 LLM / TTS 成本

#### 1.2 Pipeline 修改

- `graph.ts` 加入 conditional branching：evaluateWorthiness 返回 `skip` 時 pipeline 直接結束
- Episode 標記為 `skipped` status，保留素材資料供後續使用
- `merge_to_weekly` 時，素材自動存入 `weekly_youtube_sources`

#### 1.3 Scheduler 修改

- `schedulerInit.ts` 支援 `skipped` 狀態
- Scheduler log 記錄跳過原因
- Dashboard 首頁顯示「今日已評估，決定跳過」

### Phase 2：Deep Dive 內容管道（新 segment type）

**目標**：新增 `deepdive` segment type，從 Podcast RSS / 技術 blog / 論文取材，產出深度分析式 Podcast。

#### 2.1 新資料來源

| 來源類型 | 範例 | 用途 |
|---------|------|------|
| Podcast RSS | Latent Space, Lex Fridman, AI Explained, NVIDIA AI Podcast | 抓取最新集數 → Whisper 轉錄 → 作為分析素材 |
| 技術 Blog | Anthropic Blog, OpenAI Blog, Google AI Blog, HuggingFace | 全文抓取 → 作為背景知識 |
| ArXiv 論文 | cs.AI, cs.CL 分類熱門論文 | 摘要抓取 → 技術深度補充 |

#### 2.2 Knowledge RAG 系統

將 ingested 的 Podcast transcript、blog 文章、論文摘要 embedding 後建立向量搜尋：
- Pipeline 的 `scriptEnglish` stage 可以 query RAG 取得相關背景知識
- 讓 deep dive 腳本有更豐富的引用和分析深度

#### 2.3 腳本風格差異

| Segment | 風格 | 範例開場 |
|---------|------|---------|
| daily | 新聞播報 | 「今天有三個新工具值得關注...」 |
| deepdive | 深度解析 | 「最近 Anthropic 發布了 X，這代表什麼？讓我們從三個角度分析...」 |

#### 2.4 為什麼 Deep Dive 有潛力

1. **聽眾價值更高**：深度分析的聽眾黏著度遠高於新聞速報，會回頭聽、分享、訂閱
2. **SEO 長尾效果**：「什麼是 RAG」這種 evergreen 主題的搜尋量持續存在，不像「今天新 AI 工具」一天就過期
3. **商業價值**：深度內容的聽眾更精準，對贊助商更有價值
4. **差異化**：多數 AI Podcast 都在做速報，深度分析的競爭更少

### Phase 3：成長引擎機制

#### 3.1 SEO 長尾內容自動生成

每集 Podcast 發布後，自動從腳本 + 字幕生成 SEO blog 文章：
- 標題優化為搜尋意圖（「什麼是 X？完整解析」格式）
- 內容結構化（H2/H3、FAQ、Key Takeaways）
- 每集 Podcast 多一個 Google 搜尋入口

#### 3.2 Trending Topic Injection

取代固定 25 個 query：
- Pipeline 啟動前，LLM 分析最近 24 小時 AI trending（Google Trends、Reddit r/artificial 等）
- 動態生成 5-10 個搜尋 query 補充到固定列表
- 確保內容跟上真正的熱門話題

#### 3.3 Content Repurposing

每集 Podcast 發布後，自動生成衍生內容：
- **Twitter/X Thread**：5-7 條，每條一個 key insight
- **LinkedIn Post**：專業語調摘要，適合 B2B 受眾
- **Carousel 圖片**：key points 做成 IG/LinkedIn 滑動圖片

### Phase 4：Schedule 智慧化

#### 4.1 從固定排程到彈性排程

**目前排程**：
```
Monday 11:00 → daily（固定發）
Wednesday 11:00 → daily（固定發）
Thursday 11:00 → robot
Friday 11:00 → daily（固定發）
Saturday 11:00 → daily（固定發）
Sunday 11:00 → weekly
```

**建議排程**：
```
每天 09:00 → content evaluation（Quality Gate）
  → worthy → daily pipeline
  → not worthy → 通知 Tommy，素材留給 weekly
  → deep dive topic ready → deepdive pipeline

Thursday 11:00 → robot（維持）
Sunday 11:00 → weekly（維持）
```

一週從 4-5 集 daily 變成 2-3 集高品質內容。

#### 4.2 Dashboard UI 更新

- 顯示「本週發刊計畫」：哪天發、哪天跳過、原因
- Content worthiness score 歷史趨勢圖
- Tommy 可以 override（強制發或強制跳過）

---

## 五、成長策略的結構性缺失

目前的成長模型是**被動成長**：

```
做內容 → 發到 5 個平台 → 希望被演算法推薦
```

缺少的主動成長機制：

| 缺失項目 | 說明 | 優先級 |
|---------|------|--------|
| SEO 長尾策略 | 每集有完整腳本和字幕，但沒有轉成 blog。免費的 Google 流量入口被浪費 | P1 |
| Email / Newsletter | 沒有 email 蒐集機制。Podcast 聽眾是最高價值的 subscriber | P2 |
| Social Proof Loop | 沒有自動蒐集/展示聽眾評價和 Apple Podcasts 評分 | P2 |
| Cross-Promotion | 沒有與其他 Podcast 交叉推薦的機制 | P3 |
| Trending Topic | fetchYoutube 的 25 個 query 是固定的，沒有動態追蹤熱門話題 | P1 |
| Audience Segmentation | 完全不知道聽眾是誰（年齡/地區/設備），無法做精準內容策略 | P2 |
| Conversion Funnel | 沒有 UTM 策略，不知道聽眾從哪來 | P2 |
| Content Repurposing | 除了 Shorts，沒有其他衍生內容（blog、thread、carousel） | P1 |

---

## 六、高優先級優化建議（按影響力 x 可行性排序）

| 順序 | 項目 | 為什麼 | 預期效果 |
|------|------|--------|---------|
| 1 | Content Quality Gate | 最小改動、最大效益 | 減少低品質內容 40-50%，降低成本和 review 壓力 |
| 2 | Schedule 智慧化 | 配合 Quality Gate | 從「每天硬擠一集」變成「值得才發」 |
| 3 | Deep Dive Segment | 核心差異化 | 建立「深度分析」品牌定位，吸引高價值聽眾 |
| 4 | SEO Blog 自動生成 | 低成本高回報 | 每集多一個 Google 搜尋入口 |
| 5 | Trending Topic Injection | 解決 query 老化問題 | 確保內容跟上市場趨勢 |
| 6 | Content Repurposing | 放大已有內容的價值 | 每集內容的觸及面 x3-5 |
| 7 | 跨平台 Analytics | 建立數據基礎 | 用數據而非直覺做決策 |

---

## 七、Database Schema 變更（Phase 2 用）

```sql
-- Podcast RSS 來源管理
CREATE TABLE podcast_rss_feeds (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  rss_url TEXT NOT NULL UNIQUE,
  category TEXT DEFAULT 'ai',
  enabled INTEGER DEFAULT 1,
  last_fetched_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 抓取的 Podcast episodes
CREATE TABLE podcast_sources (
  id INTEGER PRIMARY KEY,
  feed_id INTEGER REFERENCES podcast_rss_feeds(id),
  episode_title TEXT,
  episode_url TEXT,
  published_at TEXT,
  transcript TEXT,
  summary TEXT,
  used_in_episode INTEGER REFERENCES episodes(id),
  fetched_at TEXT DEFAULT (datetime('now'))
);

-- Blog 來源
CREATE TABLE blog_sources (
  id INTEGER PRIMARY KEY,
  source_name TEXT,
  url TEXT UNIQUE,
  title TEXT,
  content TEXT,
  published_at TEXT,
  used_in_episode INTEGER REFERENCES episodes(id),
  fetched_at TEXT DEFAULT (datetime('now'))
);
```

---

## 八、關鍵檔案清單

| 檔案 | 動作 | Phase |
|------|------|-------|
| `services/pipeline/nodes/evaluateWorthiness.ts` | 新增 | 1 |
| `services/pipeline/graph.ts` | 修改（conditional branching） | 1 |
| `services/pipeline/state.ts` | 修改（加入 worthiness_score） | 1 |
| `lib/schedulerInit.ts` | 修改（支援 skip） | 1, 4 |
| `services/contentSources.ts` | 新增 | 2 |
| `services/contentRag.ts` | 新增 | 2 |
| `services/pipeline/nodes/fetchSources.ts` | 新增 | 2 |
| `db/schema.sql` | 修改（新 tables） | 2 |
| `services/blogGenerator.ts` | 新增 | 3 |
| `services/repurposer.ts` | 新增 | 3 |
| `services/pipeline/nodes/fetchYoutube.ts` | 修改（trending injection） | 3 |
| `app/scheduler/SchedulerClient.tsx` | 修改（UI 更新） | 4 |

---

## 九、驗證方式

### Phase 1 驗證
- [ ] 手動觸發 daily pipeline，確認 evaluateWorthiness node 正確評分
- [ ] 測試 score < 50 時 pipeline 正確跳過
- [ ] 測試 score 50-69 時素材正確合併到 weekly
- [ ] 確認 Telegram 通知在跳過時有發送
- [ ] `npm run build` 通過

### Phase 2 驗證
- [ ] 新增 Podcast RSS feed，確認正確抓取 + 轉錄
- [ ] 手動觸發 deepdive pipeline，確認腳本是分析式而非新聞式
- [ ] RAG query 返回相關背景知識
- [ ] 完整 pipeline 跑到 pending_review

### Phase 3 驗證
- [ ] 發布一集後，確認自動生成 blog 文章
- [ ] Blog 結構包含 H2/H3、FAQ、Key Takeaways
- [ ] Twitter thread 格式正確

### Phase 4 驗證
- [ ] 排程觸發 content evaluation 而非直接 pipeline
- [ ] Dashboard 顯示本週發刊計畫
- [ ] Override 功能正常

---

> 本文件由 Claude Code 以 Senior PM 角色產生，基於對完整 codebase（95 個 API routes、13-stage pipeline、5 個發布平台、3 個 agent）的深度分析。
