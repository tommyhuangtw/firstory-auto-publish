# 社群熱點「💬 回覆專區」設計

- **狀態**: 待 review
- **日期**: 2026-06-26
- **Worktree / Branch**: `../firstory-trends-reply` / `feat/trends-reply-zone`
- **關聯**: 延伸既有社群熱點(`services/trends/*`)+ 複用個人語料寫手 [[threads-voice-corpus]]

---

## 1. 目標

現有社群熱點是「爬熱點 → 寫一篇蹭熱點的**新貼文**」。本功能新增一個**回覆導向**的玩法:鎖定 Tommy 利基(AI 工具/接案/創業/AI 學習)的近期貼文,讓他**主動去回覆別人**,AI 幫他生成回覆草稿。

動機(爆文研究驗證):**在 niche 主動回覆別人,是被演算法推薦給陌生人、建立信任的關鍵**。

---

## 2. 已敲定決策

| 決策 | 結論 |
|------|------|
| 位置 | `/trends` 加分頁「💬 回覆專區」,與現有「寫新貼文」並存、共用爬蟲 |
| Niche 關鍵詞 | 可編輯清單(settings `trend_niche_keywords`),**每次全搜不輪替** |
| 篩選 | 近 **1-2 天** + 讚 **≥ 30** |
| 回覆策略 | 依貼文類型自動調整(求助→解答、觀點→補角度、焦慮→同理+方向) |
| 回覆長度 | **預設簡短(1-3 句)**,但依貼文可給有深度的 insight |
| 回覆口吻 | 用個人語料 bio/風格檔(聽起來像 Tommy) |
| 輸出 | 草稿 + 複製 + 去看原文(回覆無 intent 預填,複製貼上流程) |

種子關鍵詞:`AI 顧問、vibe coding、接案、n8n、claude code、AI 學習、AI 焦慮、AI 工具、AI 應用、AI 接案、創業`。

---

## 3. 資料模型

`trend_posts` 加兩欄(safeAlter):
- `niche INTEGER DEFAULT 0` — niche 爬取命中的貼文標記
- `reply_draft TEXT` — 生成的回覆草稿(可重生)

(回覆專區只查 `WHERE niche = 1`;熱點寫新貼文流程不受影響。)

---

## 4. Niche 爬取

- 在既有 Threads scan 流程中加一個 **niche pass**:讀 `trend_niche_keywords` → 用既有 Playwright 爬蟲搜每個關鍵詞(全搜、不輪替)→ 對每則貼文套用篩選:`posted_at` 在近 N 天(設定 `trend_niche_recency_days`,預設 2)且 `like_count >= 30`(設定 `trend_niche_min_likes`,預設 30)→ upsert 進 `trend_posts` 並設 `niche = 1`。
- 沿用既有 dedup(permalink)、scan_run 記錄。
- 跟著現有 trend scan(2x/天)一起跑。

## 5. 回覆生成

新 `services/trends/nicheReply.ts`:
- 輸入:一則 niche 貼文(author/text)。
- 載入個人語料 bio + 風格檔(複用 voice writer 的 `activeAsset`,缺失時 fallback brandVoice)。
- Prompt:讀原文 → 判斷類型(求助/觀點/焦慮/其他)→ 寫**短、真誠、不推銷**的回覆;**預設 1-3 句**,但當貼文值得時可給較深的 insight;以 Tommy 口吻。
- Model 用 `google/gemini-3.1-flash-lite-preview`(快、便宜),記 cost。
- 存回 `trend_posts.reply_draft`。

## 6. 元件

| 元件 | 改動 |
|------|------|
| `db/index.ts` | `trend_posts` 加 `niche` / `reply_draft`(safeAlter) |
| `services/trends/crawler.ts` 或 `pipeline.ts` | 加 niche pass(搜 niche keywords + 篩選 + 標記) |
| `services/trends/nicheReply.ts` | 新:回覆生成(複用語料) |
| `api/trends/reply/route.ts` | 新:POST 生成回覆 |
| `api/trends/niche/route.ts` | 新:GET 回覆專區貼文列表 |
| `app/trends/page.tsx` | 加「💬 回覆專區」分頁 + 每則「✍️ 生成回覆」+ 複製 + 去看原文 |
| settings | `trend_niche_keywords` / `trend_niche_recency_days` / `trend_niche_min_likes` |

## 7. 複用
既有 crawler / scan / scorer、voice 風格資產(`voice/writer` 的 activeAsset 或抽共用 getter)、settings 模式。

## 8. 非目標
- ❌ 自動發布回覆(只到草稿 + 複製;Threads 回覆無 intent 預填)
- ❌ 對 niche 貼文做共鳴 👍/👎 學習(可沿用現有,但非本 spec 重點)
- ❌ 改動現有「寫新貼文」流程

## 9. 驗收標準
1. niche pass 能搜關鍵詞、只留近 1-2 天 + 讚≥30、標 `niche=1`
2. 回覆專區分頁列出 niche 貼文(依讚/時間)
3. 「生成回覆」產出像 Tommy 口吻、依貼文類型調整、預設短的回覆;值得時可深
4. 複製 + 去看原文可用
5. 不影響現有熱點寫新貼文流程
6. `npm run build` + tsc + eslint 乾淨;實際跑一次 niche 爬 + 回覆生成 smoke test
