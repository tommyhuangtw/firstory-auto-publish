# 靈感庫 (Inspiration Library) — Design Spec

**Date**: 2026-06-24
**Status**: Approved design, ready for implementation planning

---

## 1. Problem & Goal

Tommy 在聽 podcast / 看 YouTube 時常冒出「值得分享」的靈感,但過一陣子就忘了。本功能要做一個會**累積、可搜尋、可一直滑**的 insight 銀行 — 想不到要發什麼時進來逛,某張卡片戳到他時,注入自己的經驗,讓 AI 用那個概念**重寫一篇新貼文**。

核心價值:這是 Tommy **自己的差異化觀點來源**,不是追別人正在燒的熱點。

### 與 Trends Bot 的關係(已決定)

| | Trends Bot(已上線) | 靈感庫(本案) |
|---|---|---|
| 方向 | 反應式 — 外面現在燒什麼,快蹭 | 主動式 — 我自己的料,慢慢養 |
| 來源 | 陌生人的爆紅貼文 | 我親自消費的內容 |
| 壽命 | 數小時 | 常青 |
| 輸出 | 你語氣的貼文 | 你語氣的貼文(共用) |

**整合決策:UI 分開,引擎共用。**
- UI:`/inspiration` 與 `/trends` 是兩個獨立頁面(心智模型不同)。
- 共用 1 — 品牌語氣寫手:把 `draftGenerator.ts` 的 brand-voice system prompt 抽成共用模組,兩邊都用。
- 共用 2 — 受眾共鳴 profile:重用 trends 的 embeddings + 👍/👎 profile,替每個 insight 算 resonance 分數。**不假裝預測流量**,而是對照「你的受眾真實會有反應的東西」。

---

## 2. Scope

### ✅ v1(本次建置)
- 貼**單一連結**攝取:YouTube + Apple Podcast + 手動貼文字
- 兩種入口:
  - **入口 A(你標重點)**:貼看過的影片 + 你標的重點 → AI 潤成 insight
  - **入口 B(AI 挖礦)**:貼沒看過的影片 → AI 抽出多個 insight
- `/inspiration` 滑動牆:語意搜尋 + 篩選 + 存/藏
- resonance 評分(用現有 trends profile)
- 改寫流程 → 共用品牌語氣寫手 → **僅 Threads**
- 攝取單元設計成「可被迴圈呼叫」,替未來頻道 pipeline 鋪路

### 🔜 Later(只鋪路,不建)
- 頻道級 research pipeline:給頻道名 → 抓過去一兩年內容 → fan-out 攝取單元
- 用整個頻道內容生成摘要 / 長文章
- Substack 等其他平台輸出(`insight_drafts.platform` 欄位先留好)

### ❌ 非目標
- 不在 `/trends` 頁面內合併此功能
- v1 不做即時的「整個頻道批次轉錄」(太貴/太慢,屬 Later)

---

## 3. Data Model

沿用 trends 的 `posts → topics → drafts` 模式,改成 **`source → insights → drafts`**。

### 3.1 `content_summaries`(沿用既有 stub 表,當「來源」紀錄)

既有欄位即可,代表一筆攝取的來源。`source_type` 值改用:`'youtube' | 'apple_podcast' | 'manual'`。

```
id, url, source_type, title, channel_name, thumbnail_url,
transcript, status ('pending'|'processing'|'completed'|'failed'),
error_message, cost_usd, created_at, completed_at
```
- `transcript`:YouTube 抓的字幕 / Whisper 轉錄 / 手動貼的文字
- `summary_json`:既有欄位,v1 可不使用(或存來源層級摘要,選用)

### 3.2 `insights`(新表 — 庫的核心,一筆來源 → 多個 insight)

```
id            INTEGER PK
source_id     INTEGER → content_summaries.id ON DELETE CASCADE
hook          TEXT     -- 記憶點一句話(scroll-stopping)
idea          TEXT     -- 2-3 句把 mindset 講清楚
why_share     TEXT     -- 為什麼新穎 / 值得分享(the angle)
category      TEXT     -- 'mindset'|'tactic'|'contrarian'|'story'
resonance     REAL     -- 0-100,對 trends 👍/👎 profile 評分
embedding     TEXT     -- JSON array,語意搜尋 + 評分用
origin        TEXT     -- 'ai_mined'(入口B) | 'user_marked'(入口A)
status        TEXT     -- 'new' | 'saved' | 'hidden'
source_ts     TEXT     -- 在影片/節目內的時間戳(跳回連結用,選用)
created_at    TEXT DEFAULT (datetime('now'))
```
索引:`source_id`、`status`、`resonance`。

### 3.3 `insight_drafts`(新表 — 改寫成貼文)

```
id          INTEGER PK
insight_id  INTEGER → insights.id ON DELETE CASCADE
user_note   TEXT     -- 使用者注入的經驗 / 角度
draft_text  TEXT
platform    TEXT DEFAULT 'threads'   -- v1 固定 threads,欄位為未來保留
status      TEXT DEFAULT 'pending_review'
created_at  TEXT DEFAULT (datetime('now'))
```

---

## 4. Ingestion Pipeline(可迴圈呼叫的單元)

```
貼連結 / 貼文字
   ├─ YouTube       → APIFY 抓逐字稿(沿用既有 APIFY 整合)
   ├─ Apple Podcast → iTunes Lookup API → RSS feed → <enclosure> MP3 → 下載 → Whisper 轉錄
   └─ Manual text   → 直接用
        ↓ upsert content_summaries(存 transcript)
        ↓
   ┌─ 入口 A:使用者重點 + 逐字稿上下文 → AI 潤成 insights(origin=user_marked)
   └─ 入口 B:逐字稿 → AI 抽 N 個 insights(origin=ai_mined, status=new)
        ↓ 每個 insight:算 embedding + resonance(對 profile)
        ↓
   寫入 insights 表 → 出現在靈感牆
```

### 4.1 Apple Podcast 取得音檔鏈路(正規管道,非 hack)

```
Apple 連結 (podcasts.apple.com/.../id{podcastId}?i={episodeId})
  → 抽出 podcastId + episodeId
  → iTunes Lookup API (公開免費): https://itunes.apple.com/lookup?id={podcastId}&entity=podcast
  → 取得真正的 RSS feed URL
  → 解析 RSS,用 episodeId 對到該集 → <enclosure> 的 MP3 URL
  → 下載 MP3 → OpenAI Whisper 轉錄(沿用 subtitleGenerator.ts 既有用法)
```
**成本提醒**:1 小時 podcast ≈ 2-4 分鐘 + ~$0.3-0.5 美金 Whisper。單集 OK;整個頻道屬 Later,需背景排隊 + 預算上限。

### 4.2 Insight 抽取(入口 B 的 LLM 輸出結構)

每個 insight 要產出:`hook`(記憶點一句話)、`idea`(2-3 句)、`why_share`(為什麼新穎)、`category`。
LLM 走既有 `llmService`,記錄 cost。prompt 要求:挑「反直覺、有記憶點、觀眾會想轉發」的點,避免泛泛而談。

---

## 5. Library UX

### 5.1 `/inspiration` 滑動牆

```
[+ 貼連結]   🔍 語意搜尋    篩選: 全部/已存/分類    排序: 共鳴/最新
每張卡片: 🔥共鳴分 · category / hook / idea / 💬why_share / 📺來源↗時間戳
卡片動作: 💡存(saved)  🗑藏(hidden)  ✍️改寫
```
- 語意搜尋:用 `embedding` 做 cosine 相似度(沿用 trends 的 embeddings 模組)。
- 預設排序:resonance 高 → 低。

### 5.2 改寫流程(點 ✍️)

```
顯示原 insight → 使用者填「加入我的經驗/角度」(user_note)
  → 平台固定 Threads
  → 呼叫共用品牌語氣寫手(brandVoice + draftGenerator 共用模組)
  → 產草稿 → review → 複製 / (選用)推 Telegram → 存進 insight_drafts
```

---

## 6. Integration Refactor(共用引擎)

1. **`brandVoice.ts`(新共用模組)**:把 `draftGenerator.ts` 的 brand-voice system prompt(第一人稱、台灣口語、AI 詞黑名單)抽出來。`/trends` 與 `/inspiration` 都引用。重構後 trends 行為不變(回歸測試)。
2. **resonance 評分**:重用 `src/services/trends/embeddings.ts` 的 👍/👎 profile 與 cosine 計分,對 insight 算 0-100 分。若 profile 尚未建立(👍 數不足),resonance 給 null / 中性值,不擋流程。

---

## 7. API Routes(對齊 trends 命名慣例)

```
POST   /api/inspiration/ingest          貼連結/文字,啟動攝取(背景)
GET    /api/inspiration/insights        列表(篩選/排序/語意搜尋)
POST   /api/inspiration/insights/{id}/status   存/藏(saved|hidden)
POST   /api/inspiration/insights/{id}/draft    改寫成貼文(帶 user_note)
GET    /api/inspiration/drafts          列出 insight_drafts
GET    /api/inspiration/sources/{id}    查單一來源攝取狀態
```

---

## 8. Success Criteria(可驗證)

1. 貼一個 YouTube 連結 → 數秒內 `content_summaries` 有逐字稿,`insights` 有多筆 AI 挖出的 insight,出現在 `/inspiration`。
2. 貼一個 Apple Podcast 單集連結 → 成功經 RSS → MP3 → Whisper → 逐字稿 → insights。
3. 入口 A:貼連結 + 標重點 → 產出 origin=user_marked 的 insight。
4. 靈感牆可滑動、語意搜尋、依 resonance 排序、存/藏。
5. 點 ✍️ + 填經驗 → 產出 Threads 草稿(你的語氣),存進 `insight_drafts`。
6. `/trends` 重構後行為不變(draft 產出與之前一致)。
7. `npm run build` 通過。

---

## 9. Out of Scope Reminders(避免 scope creep)

- 不做頻道批次攝取(只把攝取單元寫成可迴圈呼叫)。
- 不做 Substack/IG/FB 輸出(只留 `platform` 欄位)。
- 不做自動排程攝取(v1 全手動貼連結)。
