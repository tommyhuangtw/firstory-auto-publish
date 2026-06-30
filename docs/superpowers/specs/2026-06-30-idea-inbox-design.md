# 靈感速記（Idea Inbox）設計

**日期**: 2026-06-30
**分支**: `feat/idea-inbox`
**狀態**: Phase 1 實作完成 + e2e 測試通過

## 問題

Tommy 常在外面（手機）閃過想發文的點子，但目前沒有地方快速記下來。`/write`
是 ephemeral 的（草稿只存在 React state，重整就消失），`/inspiration` 是「貼
URL → AI 拆解 insight」的形狀，都不適合「腦中一句話先記著」。需要一個極輕、捕捉
零摩擦的 inbox：在外面隨手記，回家再用 `/write` 好好打磨成貼文。

## 目標 / 非目標

- **目標**：手機上一指可達、開頁即可打字、送出即存的捕捉介面；點子能養成草稿，也能
  一鍵丟進 `/write` 用 AI 加工。
- **非目標（Phase 1）**：語音轉文字、貼連結/截圖、AI 自動上標籤、跨裝置同步以外的
  協作功能。

## 架構（Approach A：獨立速記頁）

捕捉與加工分離 —— inbox 負責「快」，`/write` 負責「深」。

```
/ideas (捕捉 + 管理)  ──「✨ 丟進寫文章」──►  /write?idea=<text>  (AI 生成)
      │
      └─ /api/ideas (CRUD, 純 DB, 無 LLM, 離線可用)  ──►  ideas table
```

### 資料模型 — `ideas` table

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | INTEGER PK | |
| `content` | TEXT NOT NULL | 點子原文 / 工作中草稿 |
| `source_type` | TEXT | `text`（Phase 1）/ `voice` / `link`（保留） |
| `source_url` | TEXT null | 貼連結時用（保留） |
| `status` | TEXT | `new` / `developing` / `posted` / `archived`（預設 `new`） |
| `tags` | TEXT null | 保留欄位（JSON array），Phase 1 不使用 |
| `posted_url` | TEXT null | 發布後可貼回 Threads 連結（選填） |
| `created_at` / `updated_at` | TEXT | UTC `datetime('now')` |

索引：`idx_ideas_status`、`idx_ideas_created`。

### API — `/api/ideas`

| Method | Path | 用途 |
|--------|------|------|
| `GET` | `/api/ideas?status=` | 列清單（`created_at DESC`，可選 status 篩選） |
| `POST` | `/api/ideas` | 新增 `{content, source_type?, source_url?}` → 201 |
| `PATCH` | `/api/ideas/:id` | 改 `content` / `status` / `posted_url` |
| `DELETE` | `/api/ideas/:id` | 刪除 |

- 純 SQLite CRUD，無 LLM 依賴 → 捕捉又快又能離線。
- 驗證：空 content → 400；非法 status / source_type → 400；找不到 id → 404。

### UI — `/ideas`「靈感速記」

- 頂部恆在的捕捉框：autofocus、`⌘/Ctrl+Enter` 送出、送出後清空並 refocus（連發）。
- 捕捉**永不吞字**：送出失敗時保留輸入內容 + 顯示「未送出，請重試」。
- 狀態篩選 chips：進行中（new+developing）/ 未處理 / 養草稿 / 已發布 / 封存，各帶數量。
- 卡片動作：`✨ 丟進寫文章`（導 `/write?idea=`）、`✏️ 養草稿`（原地編輯，存檔時
  `new → developing`）、`✅ 已發布`、`封存`/`取回`、`🗑 刪除`。

### `/write` 整合

`/write` 在 mount 時讀 `?idea=` query param → 切 `rewrite` 模式 + 填入 idea 欄位 →
用 `history.replaceState` 清掉 param（重整不會重灌舊文字）。以 `window.location`
而非 `useSearchParams` 讀取，避免 Suspense boundary 需求與 SSR hydration mismatch。

### 導覽

`/ideas` 加入 `social` 群組（桌機側欄）+ 手機底部主要列（`MOBILE_PRIMARY_HREFS`，
5 個 primary + 更多）。捕捉速度是命脈，故放手機一指可達位置。

## 分階段

- **Phase 1（本次）**：table + CRUD API + 純打字捕捉頁 + 狀態管理 + 丟進 `/write`。
- **Phase 2**：🎤 語音轉文字（重用 `subtitleGenerator` 的 Whisper）。
- **Phase 3**：貼連結 / 截圖（Cloudinary + 可選 AI 拆解，與 `/inspiration` 共用引擎）。

## 測試（已執行）

- `tsc --noEmit` 0 error；eslint 新檔 0 error。
- API 10 case smoke test（含 400/404 邊界、status 篩選、`updated_at` bump）全綠。
- Chrome DevTools iPhone (390×844) e2e：捕捉 → 卡片出現 → 養草稿編輯（status 翻
  `developing`）→ 丟進寫文章（`/write` 正確 prefill + param 清除）→ 刪除 → 計數歸零。
- 測試資料已清除，`ideas` table row count = 0。
