# Voice Writer — 想法→Threads 文章寫手 設計

- **狀態**: 待 review
- **日期**: 2026-06-25
- **Branch**: `feat/voice-writer`
- **前置**: 依賴已 merge 的「個人風格層」(scope A) — [[threads-voice-corpus]]

---

## 1. 目標

用 [[threads-voice-corpus]] 收集的個人風格資產,讓 AI 用「Tommy 的口吻」產出 Threads 文章草稿。第一個、也是主要的消費者。

兩種模式:
- **改寫模式**:Tommy 給一個想法/草稿 → 用他的語氣改寫成 Threads 文
- **自主模式**:AI 自己發想(可給主題提示)→ 寫一篇像他的文

輸出:**草稿 + 複製按鈕**(Tommy 手動發,v1 不自動發到 Threads)。

---

## 2. 核心設計決策(已與 Tommy 敲定 2026-06-25)

| 決策 | 結論 |
|------|------|
| 介面 | 獨立新頁 **`/write`** |
| 模式 | 改寫 + 自主**兩種都做** |
| 輸出 | 草稿 + 複製(手動發,不自動發布) |
| **資產使用規則** | 見下方 §3(最重要) |

## 3. 資產使用規則(防「硬塞故事」)

> Tommy 的顧慮:AI 硬把無關的小故事 connect 到主題上。

| 資產 | 套用方式 |
|------|----------|
| **bio + 風格檔** | **永遠常駐** — 每次都注入(語氣/用詞/句構的底) |
| **故事庫** | **選用、相關才用、絕不硬塞**(三道閘,見下) |

**故事三道閘:**
1. **相關性門檻**:只有跟輸入主題 embedding 相似度過門檻的故事才會被「提名」進 prompt。不相關的根本不出現。
2. **LLM 可不用**:prompt 明確指示「故事只在自然貼合時才用;硬湊不相關的故事比不用更糟,寧可不用」。
3. **可開關**:`/write` 有「帶入個人故事」開關。

**模式預設:**
- **改寫模式 → 故事預設「關」**(除非 Tommy 的想法本身已提到親身經歷,才輕輕建議一則)
- **自主模式 → 故事預設「開」**(AI 需要素材,故事當原料)

---

## 4. 寫作 Pipeline

```
輸入(想法 or 主題)
  → ① 載入 bio + 風格檔(常駐,取 status!=hidden,pinned 優先)
  → ② embed 輸入
  → ③ 從 threads_posts 撈「相似 × 高互動」的範本(few-shot,2-4 篇)
  → ④ 若故事開啟:撈相似度過門檻的故事(可 0 則)
  → ⑤ LLM 用「他的口吻」生成草稿(故事=選用,明確允許不用)
  → ⑥ 顯示草稿(可編輯)+ 複製按鈕 + 用了哪些範本/故事(透明)
```

**範本挑選(③)**:取與輸入 embedding 最相似的 top-15,再依 `engagement_rate` 重排,取前 3-4 篇當 few-shot。兼顧「主題貼合 × 觀眾買單」。

---

## 5. 前置:Embedding(scope A 延後的部分,這次補上)

| 項目 | 做法 |
|------|------|
| 儲存 | `threads_posts` 加 `embedding TEXT`;`voice_assets`(story)加 `embedding TEXT`(safeAlter) |
| 產生 | 複用 `@/services/trends/embeddings` 的 `embedTexts`;相似度用 `cosine`(in-memory,500 多筆夠快,**不需 vec0**) |
| 時機 | backfill/sync 後補貼文 embedding;asset 生成後補 story embedding;提供 backfill 腳本補既有資料 |

複用 inspiration `themeService.ts` 的「string embedding 欄 + parseEmbedding + cosine」模式。

---

## 6. 元件

| 元件 | 路徑 | 職責 |
|------|------|------|
| 寫手服務 | `src/services/voice/writer.ts` | 組裝 context(bio/style/範本/故事)→ LLM → 草稿 |
| 範本檢索 | `src/services/voice/retrieval.ts` | embed 輸入 + cosine 撈相似貼文/故事 |
| Embedding backfill | `src/services/voice/embeddings.ts` | 補 threads_posts / stories 的 embedding |
| API | `POST /api/voice/write` | 輸入(mode, idea, useStories)→ 回草稿 + 用到的素材 |
| API | `POST /api/voice/embeddings/backfill` | 補既有資料的 embedding |
| UI | `src/app/write/page.tsx` | 模式切換、輸入、故事開關、草稿輸出、複製 |
| Nav | `Navigation.tsx` | 加「寫文章」項 |

---

## 7. UI:`/write`

- **模式切換**:改寫 / 自主
- **輸入**:
  - 改寫:想法/草稿 textarea
  - 自主:主題/角度 input(可留空 = 從他的高互動主題自由發揮)
- **「帶入個人故事」開關**(預設依模式:改寫關、自主開)
- **生成** 按鈕(fire-and-forget 或直接 await,單篇生成 ~10-20s)
- **草稿輸出**:可編輯 textarea + **複製** 按鈕
- **透明區**(可折疊):這次用了哪些範本貼文 / 哪則故事(讓 Tommy 知道 AI 參考了什麼)

---

## 8. 非目標

- ❌ 自動發布到 Threads(只到草稿 + 複製)
- ❌ 爆文結構庫(⑤,未來)
- ❌ 多平台(只做 Threads 文)
- ❌ 草稿歷史/版本管理(v1 不存,生成即用)

---

## 9. 驗收標準

1. `/write` 改寫模式:給一個想法 → 出一篇明顯「像他語氣」的 Threads 文,故事**沒被硬塞**
2. 自主模式:可生成一篇他風格的文,合理時帶入相關故事
3. 故事相關性門檻有效:不相關主題不會撈到/塞入故事
4. 範本挑選確實偏向「相似 × 高互動」
5. 複製按鈕可用;透明區顯示參考素材
6. embedding backfill 跑過,521 貼文 + 239 故事都有向量
7. `npm run build` + tsc 通過;`/write` 瀏覽器實測生成成功、無 console error
