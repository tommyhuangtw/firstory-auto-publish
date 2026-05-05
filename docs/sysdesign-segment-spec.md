# 系統設計懶懶學 — 完整規格文件

> segmentType: `sysdesign` | 手動觸發 | 20-25 分鐘 | TTS speed: 1.07x

---

## 目錄

1. [Pipeline 流程總覽](#1-pipeline-流程總覽)
2. [輸入方式](#2-輸入方式)
3. [Stage 1 — fetchYoutube（抓取影片）](#3-stage-1--fetchyoutube)
4. [Stage 2 — classify（分類 + 字幕）](#4-stage-2--classify)
5. [Stage 3 — scriptEnglish（英文講稿）](#5-stage-3--scriptenglish)
6. [Stage 4 — translate（中文翻譯）](#6-stage-4--translate)
7. [Stage 5 — qualityScore（自動評分 + 重寫）](#7-stage-5--qualityscore)
8. [Stage 6 — generateMeta（標題 / 描述 / Tags）](#8-stage-6--generatemeta)
9. [Stage 7 — generateCover（封面圖）](#9-stage-7--generatecover)
10. [Stage 8 — tts（語音合成）](#10-stage-8--tts)
11. [Stage 9 — publish（發布）](#11-stage-9--publish)
12. [Stage 10 — notify（通知 / IG 貼文 / Email）](#12-stage-10--notify)
13. [固定文案彙整](#13-固定文案彙整)
14. [與其他單元差異對照](#14-與其他單元差異對照)

---

## 1. Pipeline 流程總覽

```
使用者貼 YouTube URLs
        ↓
[fetchYoutube] 解析 URL → video IDs（跳過 YouTube API 搜尋）
        ↓
[classify] 跳過 LLM 分類 → fetch stats + transcripts → 組 sourceLinks
        ↓
[scriptEnglish] Gemini 3.1 Pro → 7500-8500 words 英文系統設計講稿
        ↓
[extractTools] Gemini Flash Lite → 提取系統設計概念/工具
        ↓
[translate] Claude Sonnet 4.6 → 6500-7500 字繁中講稿
        ↓
[customContentInsert] → [enrichMemory]
        ↓
[qualityScore] GPT-5.4 評分 + Gemini 3.1 Pro 重寫（最多 2 輪）
        ↓
[generateMeta] 標題 10 選 1 + 描述 + YouTube 描述 + Tags
        ↓
[generateCover] Gemini Flash 情境 → kie.ai 封面（系統架構風格）
        ↓
[tts] VoAI TTS（speed: 1.07x）→ FFmpeg concat
        ↓
[uploadAssets] → [notify] IG 貼文 + Email
        ↓
人工審核 → [publish] SoundOn + YouTube + Instagram
```

---

## 2. 輸入方式

- **觸發**: 完全手動（Dashboard UI 選「系統設計懶懶學」→ 貼 YouTube URL）
- **URL 輸入**: textarea，一行一個 URL
- **支援格式**: `youtube.com/watch?v=xxx`, `youtu.be/xxx`, `youtube.com/shorts/xxx`, 或純 11 字元 video ID
- **驗證**: 至少 1 個 URL，API 端驗證 `manualVideoUrls.length >= 1`

---

## 3. Stage 1 — fetchYoutube

**行為**: 跳過 YouTube Data API 搜尋，直接從使用者提供的 URL 解析 video ID。

- 不搜尋 YouTube
- 從 `state.manualVideoUrls` 解析 video IDs
- 建立 stub `VideoSource[]` 物件（只有 videoId，stats 在 classify 階段抓）

---

## 4. Stage 2 — classify

**行為**: 跳過 LLM 分類（使用者已手動篩選），但仍 fetch stats + transcripts。

- 不做 LLM 分類（is_tool / is_robotics 等）
- 透過 YouTube Videos API 抓取影片 metadata（title, channel, viewCount, likeCount 等）
- 透過 Apify 抓取所有影片字幕
- 不做 engagement filter、不做 history dedup
- 所有影片直接放入 `selectedVideos`
- 組出 `sourceLinks: { title, url }[]` 存入 state

---

## 5. Stage 3 — scriptEnglish

**Model**: `google/gemini-3.1-pro-preview`
**目標字數**: 7500-8500 words（約 20-25 分鐘）
**Temperature**: 0.7 / maxTokens: 12288

### 內容結構：問題驅動的故事弧

從「topic list」改為 question-driven story arc：
1. The Hook（1 min）— 用聽眾感受過的問題開場
2. The Challenge（3-4 min）— 框架化問題，展示為什麼這個問題很難
3. The Architecture Story（5-6 min）— 從 naive approach 開始，展示為什麼會壞掉，引出真正的架構
4. The Clever Decisions（6-7 min）— 3-5 個精選設計決策，每個用問句驅動 + so-what 收尾
5. What Breaks & What Scales（3-4 min）— 壓力測試，聚焦 1-2 個關鍵挑戰
6. Your Takeaways（2-3 min）— 2-3 個核心洞察 + pattern connection（跨系統 pattern 命名）+ 回扣開場問題

關鍵 pacing 規則：
- 每 5-6 分鐘必須有 breathing point（recap + 問句帶到下一段）
- 每個技術主題後有 so-what moment
- 用問句驅動轉場，不用平淡的「接下來我們來看」
- 至少一個 back-of-envelope calculation（QPS, storage, bandwidth 等）
- Day-job connection：把 mega-scale pattern 連結到 junior engineer 日常工作場景

### 前置步驟：Transcript 摘要

每支影片的 transcript 若超過 5000 字元，先用 Gemini 3.1 Pro 獨立摘要（1500-2000 words），再餵入寫稿 agent。
- Stage: `summarize_transcript`
- 並行處理（batch 3）
- Fallback: 摘要失敗時使用完整 transcript
- 短 transcript（< 5000 字元）直接使用，不摘要

**注意**: 其他單元（daily / robot）不做摘要，直接使用完整 transcript（已移除 `slice(0, 3000)` 截斷）。

### System Prompt 重點摘要

完整 prompt 見 `dashboard/src/services/pipeline/nodes/scriptEnglish.ts` 的 `SYSDESIGN_SYSTEM_PROMPT`。

核心結構為 **Question-Driven Story Arc**：

1. **The Hook**（1 min, ~300 words）— 用聽眾感受過的問題開場，展示 stakes
2. **The Challenge**（3-4 min, ~1200 words）— 問題框架化，為什麼 deceptively hard
3. **The Architecture Story**（5-6 min, ~2000 words）— naive approach → 為什麼壞掉 → 真正的架構
4. **The Clever Decisions**（6-7 min, ~2500 words）— 3-5 個精選設計決策，每個 question → explanation → so-what
5. **What Breaks & What Scales**（3-4 min, ~1200 words）— 壓力測試，1-2 個關鍵挑戰
6. **Your Takeaways**（2-3 min, ~800 words）— 2-3 個核心洞察 + pattern connection（跨系統 pattern 命名）+ 回扣開場問題

關鍵 pacing 規則：
- 每 5-6 分鐘必須有 breathing point（recap + 問句帶到下一段）
- 每個技術主題後有 so-what moment
- 用問句驅動轉場，不用平淡的「接下來我們來看」
- 至少一個 back-of-envelope calculation（QPS, storage, bandwidth 等）
- Day-job connection：把 mega-scale pattern 連結到 junior engineer 日常工作場景

### Interview Readiness Techniques

- 至少一個 back-of-envelope calculation with real numbers（e.g., "100M DAU × 10 requests/day ≈ 12,000 QPS, peak 3x"）
- 在關鍵設計決策處提及面試官可能的 follow-up（e.g., "面試官接下來會問：如果這個 cache 掛了怎麼辦？"）
- Takeaways 用 transferable pattern 呈現（e.g., "面試被問到任何 real-time matching 系統，先講..."）

### Topic Adaptation（5 大系統類型）

根據系統類型自動調整深潛焦點：

| 類型 | 核心問題 | 關鍵概念 | 範例系統 |
|------|---------|---------|---------|
| 📡 Real-time | 什麼必須在 X ms 內完成？ | latency budget, critical path, WebSocket vs SSE, pub-sub, geo-spatial indexing, graceful degradation | Uber, Discord, Twitch, gaming |
| 📊 Data-intensive | 如何處理 PB 級資料並毫秒級回應？ | offline/online split, feature stores, Lambda/Kappa, cold start, A/B testing, feedback loops | Netflix, Spotify, YouTube recs, Google Search |
| 🔒 Consistency-heavy | 多個操作同時發生時如何防止混亂？ | consistency models, CRDTs, OT, Raft/Paxos, 2PC/saga, idempotency, split-brain | Google Docs, Figma, Stripe, banking |
| 💾 Storage | 如何可靠地儲存和同步數十億檔案？ | chunking, dedup, sync protocols, metadata separation, erasure coding, CDN, GC | Dropbox, Google Drive, S3, iCloud |
| 🌐 Platform/API | 如何每秒可靠處理百萬 API 請求？ | API design, rate limiting, fan-out, caching layers, sharding, CQRS, notification delivery | Twitter, Instagram, URL shortener |

每類包含 core question、6-7 個 key concepts、interview gold、example systems。若系統跨多類（如 Uber = real-time + data-intensive），以 PRIMARY 類型為主線，次要類型穿插在深潛段。

### User Prompt

```
Here is the compiled content (title, description, summary) for all videos:
{每部影片的 title, channel, viewCount, summary（摘要後的內容）}

You need to help generate a summarized Podcast ENGLISH Script around 8000 words.
NOTE THAT THE PODCAST SCRIPT NEEDS TO BE IN ENGLISH!!!
```

---

## 6. Stage 4 — translate

**Model**: `anthropic/claude-sonnet-4.6`
**目標字數**: 6500-7500 字
**Temperature**: 0.7 / maxTokens: 12288

### System Prompt 重點摘要

完整 prompt 見 `dashboard/src/services/pipeline/nodes/translate.ts` 的 `SYSDESIGN_TRANSLATE_PROMPT`。

核心指引：
- ⚠️ 核心原則：「你不是在翻譯，你是在用中文重新講這個故事」— 看完英文稿後用自己的方式、以台灣工程師聊天的語氣重新組織。如果英文稿的某個解釋方式在中文裡聽起來不自然，應用完全不同的方式來解釋同一個概念。
- 目標字數：6500-7500 字
- 系統設計術語保留英文（load balancer, consistent hashing, sharding 等）
- 避免中國用語（服務器→伺服器、數據庫→資料庫 等）
- 素材來源歸因 credibility 三層優先順序：
  1. 實際在該公司工作過的工程師 → 一定要提（例：「這位是在 Uber 做過 3 年 backend 的工程師」）
  2. 該公司的官方 engineering blog → 提到這是官方第一手資料
  3. 教學型 YouTuber 的整理 → 可以提名字但不需要過度強調

### 固定開場

```
哈嘍大家好，歡迎回到 AI 懶人報。你有沒有想過，當你每天打開 Spotify 聽歌，或是在
Uber 上叫車時，背後那個能支撐全球千萬人同時使用的『大腦』到底是長什麼樣子的？今天
這個單元是，『系統設計懶懶學』。希望透過20分鐘，用輕鬆的方式，我們一起深度拆解這些
頂級的大型軟體架構。畢竟在 AI 時代，懂得怎麼把這塊拼圖拼好，比會寫 code ，還要重要
得多。那我們就開始吧！
```

（此開場為固定文案，請完整保留，不要修改。）

### 主體內容結構（問題驅動的故事弧）

1. 用 1-2 句快速帶出系統名稱和核心挑戰（不要重複描述 App 使用情境，開場已提過）
2. **素材來源集體歸因**（不可省略）：用 1-2 句帶過，優先提 credibility 最高的來源
3. **懸念式預覽**（重要！列問題不列答案）：用 2-4 句列出今天會「回答的問題」，而不是「會講的技術」，讓聽眾帶著好奇心進入深潛
   - ✅ 好：「今天我們會回答幾個很關鍵的問題：第一，這個系統怎麼在三秒內完成配對？第二，如果其中一台伺服器掛了，為什麼用戶幾乎感覺不到？」
   - ❌ 差：「今天會聊到 consistent hashing、replication、還有 auto-scaling」
4. **技術深潛 — 問題驅動的故事弧**：
   - 核心挑戰（用具體場景，不要抽象列 requirements）
   - 架構故事（從最簡單開始 → 為什麼壞掉 → 真正的架構）
   - 精彩設計決策（3-5 個最重要的，每個用「為什麼」開頭 + so-what 收尾）
   - 壓力測試（1-2 個關鍵挑戰）
   - 2-3 個收穫（回扣開頭問題 + pattern connection）
5. **資訊欄引導**（主體講完、結尾前導流之前）：自然插入一句引導聽眾去看原始影片連結

### 呼吸點 & 轉場規則

- 每講完一個技術概念（約 5-6 分鐘），插入 recap + 用問句帶到下一段
- 每個技術深潛主題結束後，用一句 so-what 收尾
- 密集技術段落後插入「喘口氣」句（比方、暫停整理、想像場景）

轉場範例（用問句驅動，不用平淡過渡）：
```
✅ 好的轉場：
「好，讀寫的問題算是解決了。但這邊有一個很現實的問題：如果你的主資料庫突然掛掉呢？」
「OK 架構講完了，但我知道很多人最好奇的是：如果使用者從一千人暴增到一千萬人，這套東西還撐得住嗎？」

❌ 差的轉場：
「接下來我們來看容錯機制」
「下一個要討論的是 caching」
```

### 結尾前導流（二選一）

```
ver1（深度連結感）:
如果今天的系統設計拆解對你有點啟發，歡迎追蹤我的 IG、Threads 和 Facebook，
搜尋「AI懶人報」就找得到。順手幫我在 Apple Podcast 給個五星好評，讓更多人
接受到我的優質內容。讓我們一起看透技術本質，一起在 AI 時代不落人後，持續進步！

ver2（行動激勵感）:
覺得今天拆解 XX App 的架構讓你有點收穫嗎？那就幫我到 Apple Podcast 按讚追蹤、
留個五星好評吧！如果你有想聽我拆解哪款 App，也歡迎去 FB、IG 或 Threads 搜
「AI懶人報」私訊跟我說。你的支持就是我繼續把節目優化的最大動力！
```

（XX 由 LLM 自動替換為本集系統名稱。）

### 結尾（五選一，專屬「系統設計懶懶學」）

```
ver1（看透本質型）:
今天的系統設計懶懶學就聊到這。希望聽完這一集，下次你再打開 XX 的時候，
看到的就不只是介面，而是它背後的設計邏輯。我是湯懶懶，我們下次見，掰啦！

ver2（實踐分享型）:
好啦，希望今天這套架構拆解有幫你補到一點技術乾貨。如果你對這個架構有什麼
不同的想法，記得來社群跟我分享喔！我是湯懶懶，我們下次見！

ver3（思維升級型）:
在這個 AI 時代，學會怎麼「設計系統」真的比「寫 code」更關鍵。別忘了訂閱
AI 懶人報，我們每集系統設計懶懶學都會帶你拆解一個大架構。我是湯懶懶，下次見，掰囉！

ver4（省時效率型）:
今天聊的這些設計模式，其實都是軟體工程大神們踩坑後的精華，希望有幫大家省下
自己摸索的時間！我是湯懶懶，我們同一個時間再見囉，掰掰！

ver5（持續演進型）:
科技發展得很快，但底層的設計邏輯其實是有跡可循的。不想錯過更多精彩的系統拆解，
記得持續鎖定 AI 懶人報。我是湯懶懶，我們下次見，掰掰！
```

（XX 由 LLM 自動替換為本集系統名稱。）

---

## 7. Stage 5 — qualityScore

**評分 Model**: `openai/gpt-5.4` (temperature 0.3)
**重寫 Model**: `google/gemini-3.1-pro-preview` (temperature 0.7)
**門檻**: 總分 > 88 通過，最多 2 輪迭代

### 評分 Prompt（sysdesign 版）

與 daily 版本相同結構，但以下替換：

| 項目 | daily 版 | sysdesign 版 |
|------|---------|-------------|
| 固定開場 | 每天都有一堆新的AI工具... | 哈嘍大家好，歡迎回到 AI 懶人報... |
| 開場說明 | （注意！！開場後僅能接續約 3-5 句...） | （句子的細部語序可自然些微調整，但整體概念要一致。開場後僅能接續約 3-5 句...） |

### 評分維度（sysdesign 版，總分 100）

| 維度 | 權重 |
|------|------|
| 聊天感與語氣自然度 | 20 分 |
| 中英夾雜控制 | 15 分 |
| 台灣用語友善度 | 15 分 |
| 說明具體性與易懂度 | 15 分 |
| 字數控制 | 15 分 |
| **結構流暢度**（sysdesign 專屬） | **20 分** |

結構流暢度檢查項目：
- a. 素材來源歸因：開場是否有用 1-2 句提到參考影片的作者或頻道背景
- b. 懸念式重點預覽：進入技術深潛之前，是否用 2-4 句列出「今天要回答的問題」（而非直接列技術名詞如 sharding、replication），讓聽眾帶著好奇心進入深潛
- c. 節奏與消化性：(i) 問句驅動轉場 (ii) recap/so-what 收尾 (iii) 3-5 個精選主題 (iv) 整體有呼吸感

### 評分輸出 JSON

```json
{
  "score": {
    "chat_feel": 0,
    "eng_mix": 0,
    "tw_localization": 0,
    "clarity": 0,
    "word_count": 0,
    "structure_flow": 0,
    "total": 0
  },
  "comments": {
    "chat_feel": "...",
    "eng_mix": "...",
    "tw_localization": "...",
    "clarity": "...",
    "word_count": "...",
    "structure_flow": "...",
    "summary": "..."
  }
}
```

### 重寫 Prompt（sysdesign 版）

與 daily 版本相同結構，但以下替換：

| 項目 | daily 版 | sysdesign 版 |
|------|---------|-------------|
| 篇幅 | 4000-5000 字 | 6500-7500 字 |
| 固定開場 | 每天都有一堆新的AI工具... | 哈嘍大家好，歡迎回到 AI 懶人報... |
| 結尾 | 明天見 | 下次見（專屬版本） |
| maxTokens | 8192 | 12288 |

重寫 user prompt 中的字數目標也對應調整為 `6500-7500` 字。

sysdesign 專屬重寫保護規則（防止重寫 agent 壓平故事弧）：

1. 保留問句驅動的轉場結構，不要改成平淡過渡（如「接下來我們來看」）
2. 保留「naive approach → 為什麼會壞掉 → 真正的解法」的故事弧，不可壓縮成直接告訴答案
3. 保留每個技術主題後的 so-what 收尾句（「所以這邊的重點是...」）
4. 保留 breathing points（recap + 問句帶到下一段），防止聽眾 fade out
5. 技術 trade-off 的解釋不可過度簡化——這是教育價值的核心
6. 保留 back-of-envelope estimation（QPS、storage 等數字計算）
7. 保留 pattern recognition 段落（跨系統的 pattern 連結）
8. 改善的重點放在語氣自然度和台灣用語，不是刪減技術內容

---

## 8. Stage 6 — generateMeta

### Step 0: 摘要（所有單元共用）

先將完整腳本濃縮為 ~800 字結構化摘要，segmentContext 為「系統設計懶懶學」。

### Step 1: 標題生成 — sysdesign 版

```
你是一位專注於系統設計教學的 Podcast 製作人，專門打造高下載量的標題。
請根據以下「系統設計懶懶學」內容生成10個標題。

── 高下載量的爆款模式（每個標題至少用 1 個）──

模式A「面試必考句型」：直擊系統設計面試痛點
  例：「面試必考！Uber 叫車系統背後的即時調度架構大揭密」
  例：「Google 面試官最愛問的系統設計題：設計一個 URL Shortener」

模式B「數字 + 規模衝擊」：用數字展現系統規模
  例：「每秒處理 100 萬筆請求！Netflix 串流背後的架構有多狂？」
  例：「10 億用戶的資料怎麼存？Google Drive 的分散式架構拆解」

模式C「知名系統 + 拆解動詞」：用大品牌帶流量
  例：「Spotify 推薦系統大拆解！為什麼它比你更懂你的音樂品味？」
  例：「Tinder 的配對演算法怎麼運作？從 swipe 到 match 的架構設計」

模式D「對比 / 選擇困境」：引發好奇心
  例：「SQL vs NoSQL 到底怎麼選？看 Instagram 的選擇就知道了」
  例：「微服務 vs 單體架構：Uber 用血淚教你怎麼選」

── 必須避免 ──
❌ 太學術或教科書感（如「分散式系統理論探討」）
❌ 沒有具體系統的抽象標題
❌ 純技術規格（如「CAP 定理推導」）

── 基本規則 ──
1. 標題長度 35-50 字
2. 包含 1 個知名系統/品牌名
3. 使用臺灣繁體中文用語
4. 不要加 EPxx 集數編號
5. 不要在標題中加入「懶懶學」（系統會自動加上）
```

### Step 2: 標題選擇

與其他單元共用同一個選擇 prompt（根據 293 集下載數據的 5 大模式評分）。

### Step 3: SoundOn 描述 — sysdesign 版

```
根據以下「系統設計懶懶學」內容生成 Podcast 描述，列出本集系統設計重點。

格式：
開頭段落（用 1-2 句帶出本集要拆解的系統及其規模）🏗️

接下來用 💡 和 👉 列出 3-5 個重點（可以是架構決策、設計模式、擴展策略等）：
💡 一句話描述這個架構重點
👉 為什麼這個設計決策重要

⚠️ 注意：💡 後面直接寫一句完整的話
❌ 錯誤：💡 Consistent Hashing：分散式系統的核心技術
✅ 正確：💡 Uber 用 Consistent Hashing 解決了百萬司機的即時配對問題

{如有 sourceLinks，附上參考資料連結}

要求：200-400字、技術含量但口語化、不含外部連結（除了參考資料）
```

### Step 3.5: YouTube 描述 — sysdesign 版

```
根據以下「系統設計懶懶學」內容摘要，生成 YouTube 影片描述的「主體內容」部分。

格式要求：
1. 開頭段落（2-3句帶出本集要拆解的系統架構）
2. 本集架構重點（每個重點直接描述設計決策和 trade-off）
3. 參考資料連結：{sourceLinks}

注意：
- 不要加 CTA 區塊（訂閱、按讚等），系統會自動加上
- 200-400字、繁體中文、技術但易讀
```

### Step 4: Tags

與其他單元共用，會根據 summary + title 自動生成 20-30 個 tags。

---

## 9. Stage 7 — generateCover

### 情境產生（Gemini Flash）

使用共用的「療癒系小劇場設計師」prompt，但 sysdesign 多出以下可用畫面元素：

```
系統架構類：白板上的架構圖、伺服器機櫃、雲端圖示、資料庫符號、負載平衡器、API 閘道圖示
```

### 圖片 Prompt（kie.ai）

與其他單元共用結構，但插畫風格替換為：

```
可愛療癒 + 廢感幽默 + 系統架構感 + 白板/藍圖元素
```

（其他單元：daily/weekly = `可愛療癒 + 廢感幽默 + 小科技感`、robot = `+ 未來機器人感`）

---

## 10. Stage 8 — tts

**Service**: VoAI TTS
**Voice**: 昱翔 / 預設 / Neo

### Audio Config（sysdesign）

| 參數 | 值 |
|------|-----|
| speed | **1.07** |
| pitch_shift | 1.5 |
| style_weight | 0.8 |
| breath_pause | 0.15 |

對照其他單元：daily = 1.09、weekly = 1.1、robot = 同 daily 1.09

### 處理流程

1. 文字清理（移除 backtick、換行、tab）
2. 切分 chunks（每 chunk ≤ 190 字元）
3. 每 5 chunks 一批次並行合成
4. FFmpeg concat 為最終 MP3

---

## 11. Stage 9 — publish

### 標題格式

| 平台 | 格式 |
|------|------|
| **SoundOn** | `EP{N} ｜ 系統設計懶懶學 – {title}` |
| **YouTube** | `AI懶人報Podcast ｜ EP{N} 系統設計懶懶學 - {title}` |

### 描述附加 sourceLinks

SoundOn 和 YouTube 描述都會自動附上：

```
---
📎 參考資料：
{影片標題}
{YouTube URL}

{影片標題}
{YouTube URL}
```

---

## 12. Stage 10 — notify

### IG 貼文 — sysdesign 版

```
📝 貼文結構（自然段落分隔，禁止使用 1. 2. 3. 編號）：

開場 hook（1～2 句）
  湯懶懶口吻帶出本集系統名稱，引起好奇心。
  範例：「Netflix 怎麼撐住全球兩億人同時追劇的？湯懶懶拆給你看 🦥」

一句鋪墊（1 句）
  簡短交代今天拆解了什麼 + 為什麼值得知道。

🏗️ 架構亮點
  3-5 個重點，每個以 emoji 開頭。
  保留英文術語（load balancer, consistent hashing, sharding 等）。

🎧 Podcast 導流句（1～2 句）
  湯懶懶口吻推薦到主頁聽完整 Podcast。

互動引導（1 句 CTA）

Hashtag（壓縮成一整段，禁止換行）
  從下列混合挑選 8~12 個：
  #系統設計 #SystemDesign #軟體架構 #面試準備 #後端工程師
  #分散式系統 #AI懶人報 #系統設計懶懶學 #湯懶懶日記
  #SlothVibes #科技職涯 #工程師日常
```

### Email 主題

```
[{yyyy-mm-dd}] AI懶人報：系統設計懶懶學
```

### Email 內容 — sysdesign 版

```
你是一位專業的系統設計教學內容編輯，擅長將系統架構概念轉換為結構清晰、
有趣易讀的繁體中文摘要。在本任務中，你的角色是《系統設計懶懶學》的
Email 週報編輯助理。

📤 格式：
開場白段落 → Podcast 連結 → 🏗️ System Design Deep Dive 🔧✨
→ 核心架構重點（3-5 bullet points）→ 📎 參考資料
```

---

## 13. 固定文案彙整

### 固定開場（翻譯 + 評分 + 重寫共用）

```
哈嘍大家好，歡迎回到 AI 懶人報。你有沒有想過，當你每天打開 Spotify 聽歌，或是在
Uber 上叫車時，背後那個能支撐全球千萬人同時使用的『大腦』到底是長什麼樣子的？今天
這個單元是，『系統設計懶懶學』。希望透過20分鐘，用輕鬆的方式，我們一起深度拆解這些
頂級的大型軟體架構。畢竟在 AI 時代，懂得怎麼把這塊拼圖拼好，比會寫 code ，還要重要
得多。那我們就開始吧！
```

（此開場為固定文案，請完整保留，不要修改。）

### 結尾前導流（二選一）

```
ver1（深度連結感）:
如果今天的系統設計拆解對你有點啟發，歡迎追蹤我的 IG、Threads 和 Facebook，
搜尋「AI懶人報」就找得到。順手幫我在 Apple Podcast 給個五星好評，讓更多人
接受到我的優質內容。讓我們一起看透技術本質，一起在 AI 時代不落人後，持續進步！

ver2（行動激勵感）:
覺得今天拆解 XX App 的架構讓你有點收穫嗎？那就幫我到 Apple Podcast 按讚追蹤、
留個五星好評吧！如果你有想聽我拆解哪款 App，也歡迎去 FB、IG 或 Threads 搜
「AI懶人報」私訊跟我說。你的支持就是我繼續把節目優化的最大動力！
```

（XX 由 LLM 自動替換為本集系統名稱。）

### 結尾（五選一，專屬「系統設計懶懶學」）

```
ver1（看透本質型）:
今天的系統設計懶懶學就聊到這。希望聽完這一集，下次你再打開 XX 的時候，
看到的就不只是介面，而是它背後的設計邏輯。我是湯懶懶，我們下次見，掰啦！

ver2（實踐分享型）:
好啦，希望今天這套架構拆解有幫你補到一點技術乾貨。如果你對這個架構有什麼
不同的想法，記得來社群跟我分享喔！我是湯懶懶，我們下次見！

ver3（思維升級型）:
在這個 AI 時代，學會怎麼「設計系統」真的比「寫 code」更關鍵。別忘了訂閱
AI 懶人報，我們每集系統設計懶懶學都會帶你拆解一個大架構。我是湯懶懶，下次見，掰囉！

ver4（省時效率型）:
今天聊的這些設計模式，其實都是軟體工程大神們踩坑後的精華，希望有幫大家省下
自己摸索的時間！我是湯懶懶，我們同一個時間再見囉，掰掰！

ver5（持續演進型）:
科技發展得很快，但底層的設計邏輯其實是有跡可循的。不想錯過更多精彩的系統拆解，
記得持續鎖定 AI 懶人報。我是湯懶懶，我們下次見，掰掰！
```

（XX 由 LLM 自動替換為本集系統名稱。）

---

## 14. 與其他單元差異對照

| 項目 | daily | weekly | robot | **sysdesign** |
|------|-------|--------|-------|---------------|
| 觸發 | cron 每日 | cron 每週 | cron 每週 | **手動** |
| 輸入 | YouTube 自動搜尋 | YouTube 自動搜尋 | YouTube 自動搜尋 | **手動貼 URL** |
| LLM 分類 | 有 | 有 | 有 | **跳過** |
| 英文講稿字數 | ~5000 | ~5000 | ~6000 | **7500-8500** |
| 中文講稿字數 | 4000-5000 | 4500-5500 | 5000-6000 | **6500-7500** |
| 時長 | ~10 min | ~15 min | ~15 min | **20-25 min** |
| TTS speed | 1.09 | 1.10 | 1.09 | **1.07** |
| 封面風格 | 小科技感 | 小科技感 | 未來機器人感 | **系統架構感 + 白板/藍圖** |
| 結尾用語 | 明天見 | 明天見 | 明天見 | **下次見** |
| 發布附連結 | 無 | 無 | 無 | **附 sourceLinks** |
| SoundOn 標題 | EP{N} – {title} | EP{N} ｜ AI懶人精選週報 – {title} | EP{N} ｜ 機器人觀察週報 – {title} | **EP{N} ｜ 系統設計懶懶學 – {title}** |
| UI badge 顏色 | blue | violet | amber | **teal** |
