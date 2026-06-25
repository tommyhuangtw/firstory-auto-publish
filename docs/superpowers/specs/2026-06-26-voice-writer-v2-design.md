# Voice Writer v2 + 靈感庫整合 設計

- **狀態**: 待 review
- **日期**: 2026-06-26
- **Branch**: `feat/voice-writer`(接續)
- **前置**: Voice Writer v1 已實作 — [[threads-voice-corpus]]

---

## 1. 問題與目標

v1 寫手把整篇舊文當 few-shot 範本,導致**大量複製 Tommy 的金句、開場、故事** → 讀者會膩,不是要的效果。

**目標**:讓寫手用 Tommy 的**口吻(怎麼說)**去**延伸出新的 mindset**,而不是重組舊內容。資產是「前情提要/記憶」,塑造視角與語氣,**不是拿來抄的模板**。並把**靈感庫**接成 mindset 來源。

---

## 2. 已敲定決策

| 決策 | 結論 |
|------|------|
| 範本(舊文 few-shot) | **拿掉**(Approach A)。口吻只靠蒸餾的風格檔 + bio |
| 招牌金句/口頭禪 | **整個拿掉** — 風格檔重生成時不含;寫手也不用 |
| 每篇聚焦 | **1-2 個重點/mindset**,不貪多 |
| 故事 | **背景知識**(懂視角用),opt-in,**除非要講否則不複述** |
| mindset 來源 | 自己打想法 / 從靈感庫挑 / 🎲 骰一則隨機 insight |
| 寫作入口 | `/write`(三入口)+ `/inspiration` 的「改寫」(改用個人口吻) |
| 不變 | 草稿+複製(不自動發)、重生不同、flash-lite model |

---

## 3. 寫手 prompt 重設計(核心)

**注入(常駐)**:bio + 風格檔(抽象語氣/句構/節奏,**不含金句**)。
**不再注入**:整篇舊文範本。
**故事**:opt-in、相似度 gating,當「背景」放入,並明確「除非自然且必要,否則不要複述具體故事」。

**新增硬規則(寫進 system prompt)**:
1. 一篇只聚焦 **1-2 個重點/mindset**,講深、不貪多。
2. 延伸出**新的觀點/角度**,**絕不重用**他過去的開場白、金句、口頭禪、具體故事。
3. 用他的**語氣與思考方式**表達,不是模仿特定句子。
4. 讀者看過他的舊文,**避免任何似曾相識的套路**。

---

## 4. 風格檔重生成(assets.ts)

改 `generateStyleProfile` 的 distiller prompt:
- 萃取**可轉移的語氣機制**:語氣態度、句構節奏、段落習慣、開場/結尾的**結構手法**(非具體句子)、用詞**風格層級**(正式/口語/比喻傾向)、emoji 習慣、長度。
- **明確排除**:不要列出招牌金句/口頭禪/簽名句;若提及,只標為「避免淪為口頭禪」。
- 重生成一次取代現有 draft 風格檔。

---

## 5. Mindset 來源 = 靈感庫

`insights` 表(1411 則:`hook / idea / why_share / resonance`)即 mindset 池。
- **挑一則**:從靈感庫選 → 帶入寫手當 mindset
- **🎲 骰一則**:隨機抽一則 insight(沿用 `/api/inspiration/insights?sort=random` 既有機制)→ 顯示 → 用它寫

寫手輸入抽象化為 `{ mindset, mode, useStories }`,其中 mindset 可來自:自打想法 / insight(hook+idea+why_share)。

---

## 6. 元件改動

| 元件 | 改動 |
|------|------|
| `services/voice/assets.ts` | 改 style distiller(去金句、純語氣機制)→ 重生成 |
| `services/voice/writer.ts` | 移除範本 few-shot;加 1-2 重點/反抄襲/延伸新觀點規則;故事改「背景」框架 |
| `app/write/page.tsx` | 三入口:打想法 / 挑靈感 / 🎲骰靈感;顯示選中的 mindset |
| `api/voice/write` | 接受 mindset(text 或 insightId);骰靈感用既有 random insight API |
| `app/inspiration/page.tsx` + `api/inspiration/insights/[id]/draft` | 「改寫」改用 voice writer(個人口吻)+「帶入小故事」開關 |

> `retrieveExamples` 在 writer 不再使用(Approach A);保留函式或移除由實作決定。post embedding 仍可留(無害),story embedding 仍需(故事檢索)。

---

## 7. 非目標

- ❌ 自動發布到 Threads
- ❌ 招牌金句(明確移除)
- ❌ 多平台、草稿版本管理

---

## 8. 驗收標準

1. 生成的草稿**不含**他舊文的金句/開場/具體故事(抽查數篇,跟舊文比對無雷同套路)
2. 一篇只聚焦 1-2 個重點
3. 重生同一輸入會不同
4. 🎲 骰靈感:抽到一則 insight → 能據此寫出他口吻的新文
5. `/inspiration` 改寫改用個人口吻 + 故事開關有效
6. 風格檔重生成後不再列招牌金句
7. `npm run build` + tsc + eslint 乾淨;`/write` 與 `/inspiration` 瀏覽器實測生成成功、無 console error
