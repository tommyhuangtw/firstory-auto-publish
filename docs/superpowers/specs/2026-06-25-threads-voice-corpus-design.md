# Threads 個人風格層 (Personal Voice Corpus) — Scope A 設計

- **狀態**: 待 review
- **日期**: 2026-06-25
- **Branch**: `feat/threads-voice`
- **作者**: Tommy + Claude (brainstorming)

---

## 1. 目標與動機

把 Tommy 自己的 Threads 貼文(完整歷史)變成一個**可被多處取用的「個人風格層」**,讓未來的 AI 寫作流程能:

- Follow 他的**語氣、結構、用詞習慣**
- 引用他寫過的**個人小故事/案例**
- 把他的內容當 **context**
- 一眼看到**哪些貼文觀眾最買單**(互動數據)

**Scope A 只做「地基」**:語料 + 互動數據 + 自動生風格資產 + 瀏覽/排行 UI。
**寫手 component(想法→Threads 文章)是下一個獨立 spec。**

### 第一個消費者 / 擴展方向 (E)
這層設計成共用層。第一個消費者是未來的「想法→Threads 文章」寫手;之後 inspiration / trend bot / 多 agent 都能取用同一份資產。架構上不綁死任何單一消費者。

---

## 2. 前置驗證(已完成的 spike)

Threads API 風險已於 2026-06-25 實測解除,以下皆為**已驗證事實**:

| 項目 | 結果 |
|------|------|
| 授權 scope | `threads_basic` + `threads_content_publish` + `threads_manage_insights`(已存入 DB token) |
| 讀貼文 | `GET /me/threads` 分頁可抓**完整歷史 521 篇**(2025-06-09 → 2026-06-25) |
| 互動數據 | `GET /{post-id}/insights` 可讀 `views, likes, replies, reposts, quotes, shares` |
| 類型分布 | 純文字 290 / 圖片 104 / 多圖 93 / 影片 32 / 轉發 2 |
| 發文 | token 具 `threads_content_publish`,既有 `postTextToThreads()` 已驗證 |

授權 token 存於 DB `settings`:`threads_user_id` / `threads_access_token` / `threads_username`。

> 注意:OAuth callback 因 `hub.ailanbao.org` 被 Cloudflare Access 保護而無法走公開網址;目前是透過 **localhost** 完成授權。Production 自動化若需從公開網址重新授權,要為 `/api/auth/threads*` 設 Cloudflare Access Bypass(本 spec 範圍外)。

---

## 3. 設計決策(已與 Tommy 敲定)

| 決策點 | 結論 |
|--------|------|
| 風格機制 | **混合**:常駐蒸餾資產 + 之後動態挑高互動範本(few-shot)。本 spec 先建資產層 |
| 「觀眾喜歡」排序 | **互動率**(依觸及 normalize),非原始互動數 |
| v1 範圍 | **完整地基**:含 LLM 自動生風格資產 |
| 故事庫建法 | **LLM 自動抽 + 人可釘選/刪**(草稿可編輯) |
| 資產生成模式 | 自動生草稿 → 人可編輯/釘選/隱藏(B 模式) |

### 互動率定義
```
engagement_rate = (likes + replies + reposts + quotes + shares) / max(views, 1)
```
- `views = 0` 時退回以原始互動總和排序(避免除以 0 衝高)
- 排行榜預設依 `engagement_rate` 由高到低

---

## 4. 五種資產(共用層的核心)

| # | 資產 | 內容 | 來源 | 用途 |
|---|------|------|------|------|
| ① | 背景檔 (Bio) | 你是誰、在做什麼、立場、常談主題 | LLM 提議 + 人編輯 | 常駐注入 |
| ② | 風格檔 (Style Profile) | 語氣、句構、開頭/結尾套路、用詞、emoji、長度 | LLM 從④蒸餾 | 常駐注入 |
| ③ | 故事庫 (Story Bank) | 從貼文抽出的個人小故事/案例,打主題標籤 | LLM 抽取 + 人釘選/刪 | 寫到相關主題時撈一則 |
| ④ | 貼文語料 (Post Corpus) | 原始貼文全文 + 互動數據 + embedding | Threads API | 排行/瀏覽 + 之後 few-shot 來源 |
| ⑤ | 爆文結構庫 (Viral Playbook) | 〔**未來**,不在 v1〕研究出的爆文結構模板 | 研究流程 | 寫作時套結構骨架 |

②③ 皆從 ④ 蒸餾 → 餵一次完整貼文歷史即可自動生成,人再微調。

---

## 5. 資料模型(新增 table)

沿用既有 SQLite 慣例(`src/db/index.ts` 的 `CREATE TABLE IF NOT EXISTS` + `safeAlter`)。

### `threads_posts` — 貼文語料 (④)
```
post_id          TEXT PRIMARY KEY      -- Threads media id
text             TEXT                  -- 貼文內文
media_type       TEXT                  -- TEXT_POST | IMAGE | CAROUSEL_ALBUM | VIDEO | REPOST_FACADE
permalink        TEXT
posted_at        TEXT                  -- ISO timestamp
views            INTEGER DEFAULT 0
likes            INTEGER DEFAULT 0
replies          INTEGER DEFAULT 0
reposts          INTEGER DEFAULT 0
quotes           INTEGER DEFAULT 0
shares           INTEGER DEFAULT 0
engagement_rate  REAL                  -- 計算後存,供排序
is_repost        INTEGER DEFAULT 0     -- REPOST_FACADE 標記,排除出風格範本
fetched_at       TEXT
insights_at      TEXT                  -- 互動數據最後刷新時間
```

### `threads_post_vectors` — embedding(複用 `inspiration/vectorIndex.ts` 的 sqlite-vec 模式)
- 對 `threads_posts.text` 做 embedding,供之後寫手依主題挑範本
- 沿用既有 vec0 虛擬表 + `serverExternalPackages` 設定(已存在)

### `voice_assets` — ①②③ 統一存
```
id            INTEGER PRIMARY KEY
type          TEXT    -- 'bio' | 'style' | 'story'
content       TEXT    -- 資產內文(背景段落 / 風格條目 / 故事內容)
topic_tags    TEXT    -- JSON array,主要給 story 用
source_post_id TEXT   -- story 來源貼文(可 null)
pinned        INTEGER DEFAULT 0
status        TEXT    -- 'draft' | 'kept' | 'hidden'
updated_at    TEXT
```

---

## 6. 元件與資料流

### 6.1 Threads 讀取 service(擴充既有 `src/services/threads.ts`)
新增**讀取** function(既有檔只有發文):
- `fetchAllThreadsPosts()` — 分頁抓完整歷史(已驗證可行)
- `fetchPostInsights(postId)` — 抓單篇互動數據
- 沿用既有 `getCredentials()`(讀 DB settings token)

### 6.2 同步 (Sync)
- **一次性 backfill**:抓全部貼文 → 每篇抓 insights → 算 engagement_rate → 寫入 `threads_posts` → 生 embedding
- **增量 sync**(cron,沿用既有 `scheduler.ts`):
  - 補新貼文
  - 刷新「近 N 天」貼文的互動數(舊文互動趨於穩定,不需常刷)
- 失敗隔離:單篇 insights 失敗不影響其他(沿用專案慣例)

### 6.3 風格資產生成 service(新 `src/services/voice/`)
- `generateStyleProfile()` — 餵貼文語料 → LLM 蒸餾 ②風格檔(存 `status=draft`)
- `extractStories()` — LLM 從貼文辨識個人小故事/案例 → 打主題標籤 → 存 ③(`status=draft`)
- `suggestBio()` — LLM 提議 ①背景(`status=draft`)
- 全部走既有 `llmService`(自動記 cost)
- 觸發:backfill 後自動跑一次;UI 可手動「重新生成」

### 6.4 UI:新頁 `/voice`
- **貼文牆**:預設依 `engagement_rate` 排序(可切回時間序);顯示互動數據;沿用 inspiration 既有瀏覽/分頁元件
- **風格資產區**:看/編輯/釘選/隱藏 ①②③;手動新增 bio / 把貼文加進故事庫
- **同步狀態**:顯示上次 backfill / sync 時間,提供「立即同步」「重新生成資產」按鈕

### 6.5 補強既有 settings 頁
把 `/settings` 的「Threads 連結」從「開發中」佔位**接上真正的授權按鈕**(指向 `/api/auth/threads`),並顯示連線狀態(沿用 `/api/auth/threads/status`)。順手補 `settings/page.tsx:82` 缺少的 `.catch`(避免單次 fetch 失敗卡死 Loading)。

---

## 7. API routes(新增)
- `POST /api/voice/sync` — 觸發 backfill / 增量同步
- `GET /api/voice/posts` — 貼文牆資料(支援排序/分頁)
- `POST /api/voice/assets/generate` — 重新生成 ①②③ 草稿
- `GET/PATCH/DELETE /api/voice/assets` — 資產 CRUD(編輯/釘選/隱藏)

---

## 8. 複用對照

| 需求 | 複用 |
|------|------|
| embedding / sqlite-vec | `src/services/inspiration/vectorIndex.ts` 模式 |
| 排程 | `src/services/scheduler.ts` |
| LLM + cost 記錄 | `src/services/llmService.ts` |
| Threads 憑證/呼叫 | 擴充 `src/services/threads.ts` |
| 瀏覽/分頁 UI | inspiration 既有元件 |

---

## 9. 非目標 (Non-goals,本 spec 不做)

- ❌ 寫手 component(想法→Threads 文章)— **下一個 spec**
- ❌ 依主題動態挑 few-shot 範本的寫作邏輯 — 隨寫手 spec
- ❌ ⑤ 爆文結構研究 — 未來
- ❌ Threads 以外的內容來源(Substack / podcast 腳本)— 架構上不排除,但 v1 只吃 Threads
- ❌ Cloudflare Access bypass(production 公開網址授權)— 目前用 localhost 授權即可
- ❌ 自動發文到 Threads — 本層只讀

---

## 10. 驗收標準

1. 從 0 跑 backfill → `threads_posts` 有 ~521 筆,含正確互動數據與 engagement_rate
2. `/voice` 貼文牆能依互動率排序,且數字與 Threads 後台一致(抽樣比對)
3. 自動生出 ②風格檔、③故事庫(≥ 數則,有主題標籤)、①背景草稿
4. 資產可編輯/釘選/隱藏,且持久化
5. 增量 sync 能補新貼文 + 刷新近期互動數,不重複、不漏
6. `/settings` 能看到 Threads 連線狀態並重新授權
7. `npm run build` 通過;backfill / sync 跑過實際 smoke test

---

## 11. 風險與待確認

- **互動數據刷新窗口**:增量 sync 要刷新「近幾天」的互動?(待定;預設近 14 天,可調)
- **資產生成成本**:521 篇蒸餾風格 + 抽故事是一次性 LLM 批次,成本待估(走 llmService 會記錄)
- **故事「定義」**:LLM 如何判定一段內容算「個人小故事/案例」需在 prompt 中明確定義,首批產出後人工校準
