# Substack 經營策略 + 一鍵產草稿功能 — 設計文件

**日期**: 2026-06-23
**作者**: Tommy + Claude（Substack 資深企劃視角）
**狀態**: 待 review

---

## 0. 背景與目標

AI 懶人報已有完整 podcast 自動化 pipeline（YouTube → AI 腳本 → TTS → 多平台發布）。
Tommy 已建立 Substack page（`@ailanrenbao`，目前空白），動機是 **Substack 自帶的網絡型流量可擴大懶人報觸及**。

本文件包含兩部分：
1. **經營策略 / Operating Playbook** — Substack 怎麼經營才符合品牌、最大化觸及與 SEO
2. **功能設計** — review page 上「一鍵產生 Substack 草稿」並在 dashboard review 的流程

### 成功標準（可驗證）
- review page 上點按鈕，能對某一集 episode 產出一篇「好讀 + SEO 化」的繁中電子報草稿
- 草稿可在 dashboard 反覆 review/編輯，不需重產
- 提供「複製格式化內容 + 開啟 Substack 新文章頁」，Tommy 貼上即可發佈
- 第一版**完全不依賴非官方 cookie API**

---

## 1. 關鍵研究結論

### 1.1 自動化可行性（Substack API）
- **Substack 沒有官方 API（讀/寫都沒有）。** 無法官方、穩定地全自動發佈。
- 非官方逆向 API（用 `sid` / `substack.sid` / `substack.lli` cookie）可建草稿/發佈，但 cookie 會過期、Substack 改版會壞、屬灰色地帶 → **第一版不採用**。
- **決策**：產草稿 + review 放在自家 dashboard（穩定可控）；推進 Substack 第一版採「**複製貼上**」（零風險）。日後可選擇性加非官方 API 推草稿。

### 1.2 SEO（被 Google 搜到 → 被動觸及）
- Substack 本身在 Google 有強網域權重，長文有機會被動被搜到 → 對「擴大觸及」是真利多。
- 每篇要設**獨立的 SEO 標題 + meta description**（Substack 後台有獨立欄位）。
- SEO 標題用「具體關鍵字 + 好處」，勿過長（Google 會截斷）。
- **先用預設 `.substack.com` 網域**，借 Substack 既有權重；自訂網域從零起算，暫不採用。

### 1.3 觸及 / 演算法（被 Substack 推）
- **Notes 才是觸及陌生人的引擎，不是電子報。** Notes 演算法只獎勵一件事：「讓人想訂閱的連結感」（故事 > 攻略、脆弱 > 塞價值）。
- 發文當週發 3+ 則主題相關 Notes 的人，多 ~50% 訂閱。
- **可被 restack 的金句**會帶來訂閱 → 文章要刻意寫短、可引用的句子。
- 封面圖最關鍵：**1456×1048（14:10）原創圖** > 圖庫。**質感優先 → 用 Canva 品牌模板**（固定排版只換標題文字），比每次 AI 生圖更穩、更像一個品牌。不自動沿用 IG 圖。封面會被縮小顯示 → 簡單、高對比、少字。詳見 §2.5。
- Recommendations（電子報互推）是第二層成長來源，累積訂閱後再經營。

### 1.4 節奏（cadence）
- **電子報：值得發再發（不定期）+ Tommy 親自 review。** 符合「雜訊多反而掉訂閱」的判斷，且健康。
- **Notes：維持高頻**（成長靠 Notes，不靠電子報頻率）。
- Notes 素材可複用現有 Threads 趨勢爬蟲（`trend-viral-bot`）產出。

---

## 2. 經營策略 / Operating Playbook

### 2.1 頁面設定（最先做）
- 出版品名稱：`Tommy's Substack` → **改為「AI 懶人報」**（品牌化，含 logo / 配色）。
- Bio 保留現有方向（「每天十分鐘，精選 5 支最多人看的 AI 工具影片」）——已寫得清楚。
- 網域：維持預設 `.substack.com`。

### 2.2 內容素材分工
| 素材 | 用途 | 形式 |
|------|------|------|
| Podcast 每集 | 電子報主體 | 改寫成「AI FDE 分享 mindset」的 essay（工具/主題當素材，非逐字改寫） |
| Threads 趨勢貼文 | 成長引擎 | 發成 Notes |
| IG 每日封面 | 內文配圖（非封面） | 封面改用 Canva 品牌模板（見 §2.5），不自動沿用 IG 圖 |

### 2.3 文章模型：AI FDE Essay（取代「5 工具清單」）

**核心轉變**：文章不是 podcast 腳本的逐字改寫，而是**用那一集精選的工具/主題當「論點的證據」，包進一篇 AI FDE 第一人稱分享 mindset 的 essay**。有結構骨幹（systems thinking / FDE），但讀起來像實踐者在分享自己怎麼想、踩過什麼坑。

骨架（拆解自高流量 AI Substack，見 §2.4）：

```
標題：挑釁式宣稱 / 反直覺 / 重新定義（不是「今天 5 個工具」）
       例：「我讓 pipeline 自動產 30 支 podcast，最反直覺的 3 件事」
副標 (deck)：一句話先講「為什麼這重要」= thesis 預告

① 開場 hook：具體場景 / 悖論，把讀者拉進一個熟悉的問題（不是名詞解釋）
② 正文（H2 分段）：現況 → 連到更大的模式 → 給可用的框架
   - 該集精選的工具/主題在這裡當「證據」出現，服務論點，不是條列清單
   - 第一人稱、分享我怎麼想 / 踩過什麼坑
③ 收尾：一句可被 restack 的金句洞見
④ CTA：聽完整 podcast（內嵌音檔）/ 追蹤 Threads
```

格式：約 1,500–2,500 字、H2 分段、短段落、粗體掃讀。

### 2.4 語氣 / Style Reference

- **語氣**：反思型實踐者——又樂觀又懷疑、像咖啡桌聊天不是上課（conversational yet credible）。第一人稱分享 mindset。
- **標竿帳號**（改寫時的風格參照）：
  - **One Useful Thing**（Ethan Mollick）：清醒、experiment-driven、現況→更大模式→實用框架
  - **Latent Space**（swyx）：寫給 builder、會定義新術語、挑釁式標題 + 副標交付「為什麼重要」
  - **Chain of Thought**（Dan Shipper）：thinking out loud、邀讀者一起思考
- **避免**：AI 腔、空泛攻略、純新聞轉述、條列清單感。沿用專案既有「AI-style blacklist」。

### 2.5 封面圖（質感 + 分階段自動化）

- **規格**：1456×1048（14:10）；封面會被縮小顯示 → 簡單、高對比、少字。
- **v1（手動、快又有質感）**：建**一個 Canva 品牌模板**（配色/字型/logo 固定排版），每集複製模板 + 換標題文字 + 匯出（約 1 分鐘）。模板式封面比每次 AI 生圖更穩、更像一個品牌。
- **Phase 2（自動化，只 review）**：pipeline 把該集標題 autofill 進模板 → 產封面 → review 頁核可。兩條技術路：
  - **Templated.io 之類**：非 Enterprise，專做模板 + API autofill，適合接 pipeline。
  - **Canva Connect Autofill API**：原生 Canva，但需 **Canva Enterprise**（個人帳號門檻）；本環境已連 Canva 整合，亦可走「Claude 從 brand template 生封面」路徑，待驗證。
- 不採用每次純 AI 生圖（風格易飄，與「質感一致的品牌」相違）。

### 2.6 文章內插圖（Unsplash 編輯照片）

- 文章「封面」之外，內文也插入 1–2 張有質感的編輯照片，提升閱讀體驗。
- 來源：**Unsplash**（編輯照片、免費、最貼近 Substack 質感，不像 AI 生圖會風格漂移）。需 `UNSPLASH_ACCESS_KEY`（放 `dashboard/.env.local`）。
- 流程：LLM 在 essay 適合的 section 之間標 `[[IMG: 英文關鍵字]]` → `unsplashService.findImage()` 取一張 landscape 照片 → 換成 markdown 圖片 + `Photo by … on Unsplash` 出處（含 UTM，符合 Unsplash API 條款 + 觸發 download 端點）。上限 2 張。
- 容錯：沒 key／查無結果 → 標記直接移除，文章照常產出。
- 與 copy-paste 相容：preview 渲染 `<img>`，複製 rich HTML 時一起進剪貼簿，貼進 Substack 由 ProseMirror 匯入。
- Service: `dashboard/src/services/unsplashService.ts`。
- **換圖（換一張）**：每張圖的關鍵字 + 候選 index 存在 `substack_drafts.images_json`。review 頁每張圖有「換一張」（抓同關鍵字下一張候選）與可編輯關鍵字「用關鍵字重抓」。API：`POST /api/substack-drafts/[id]/swap-image {imageUrl, query?}`；`swapDraftImage()` 換候選並就地替換內文的圖 + 出處。

---

## 3. 功能設計：一鍵產 Substack 草稿

### 3.1 使用者流程
```
[episode review page]
   └─ 按鈕「產生 Substack 草稿」
         │  llmService：該集 繁中腳本 + 工具清單 + meta → 改寫成 §2.3 FDE essay
         │  自動帶入：SEO 標題、副標(deck)、meta description、內嵌音檔連結
         │  封面圖留空（v1 由 Tommy 用 Canva 品牌模板手動製作，見 §2.5）
         ▼
   [dashboard Substack 草稿 review 介面]
         │  讀 / 編輯 / 微調（可反覆，不重產）
         ▼
   發佈（v1）：
     ├─「複製格式化內容」按鈕
     └─「開啟 Substack 新文章頁」按鈕 → 貼上 → 在 Substack 按發佈
```

### 3.2 資料模型
新增 table `substack_drafts`（一集 episode → 一篇草稿）：

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | INTEGER PK | |
| `episode_id` | INTEGER FK | 對應 episodes |
| `seo_title` | TEXT | SEO 標題 |
| `deck` | TEXT | 副標 / thesis 預告 |
| `seo_description` | TEXT | meta description |
| `cover_image_url` | TEXT | 預設留空；v1 由 Tommy 用 Canva 模板手動製作（見 §2.5） |
| `body_markdown` | TEXT | 文章正文（Markdown） |
| `audio_url` | TEXT | podcast 音檔連結（內嵌用） |
| `status` | TEXT | `draft` / `published`（人工標記） |
| `created_at` / `updated_at` | TEXT | |

> 用獨立 table（非塞 episodes 欄位）：草稿欄位多、需可編輯狀態、與 episode 生命週期分離。
> 沿用 `safeAlter` / schema.sql 既有 migration 模式。

### 3.3 元件分工
| 單元 | 職責 | 依賴 |
|------|------|------|
| `substackDraftService`（新） | 組 prompt → llmService 改寫 → 回 structured 草稿；存取 `substack_drafts` | llmService, db |
| `POST /api/episodes/[id]/substack-draft` | 觸發產草稿，回草稿內容 | substackDraftService |
| `PATCH /api/substack-drafts/[id]` | 儲存編輯後草稿 | db |
| `GET /api/substack-drafts/[id]` | 讀草稿 | db |
| review page 按鈕 + 草稿 review UI（新元件） | 觸發、顯示、編輯、複製、開 Substack | 上述 API |

### 3.4 LLM 改寫
- 輸入：該集繁中腳本（translate node 產物）+ 工具清單 + meta（標題/描述）。
- 輸出：照 §2.3 **AI FDE essay** 骨架，繁中，含挑釁式標題、副標(deck)、開場 hook、H2 分段正文（工具當證據）、可 restack 金句、CTA。
- prompt 注入 §2.4 語氣指引 + 標竿帳號風格參照；明確要求第一人稱 mindset、避免清單感。
- 用既有 llmService（自動記 cost/tokens）。沿用專案「AI-style blacklist」避免 AI 腔。

### 3.5 複製貼上的格式保真
- **關鍵**：Substack 編輯器是 ProseMirror（rich text），**不會把貼上的 raw Markdown 轉格式**；但對 **HTML / rich text 貼上保真度高**（標題/粗體/清單/連結/引用都保留，等同從 Google Docs 貼）。
- 因此：內部**存 Markdown**（好編輯）→ review 介面 **render 成 HTML 顯示** → 「複製」按鈕複製 **rich HTML（`text/html` 寫入剪貼簿）**，不是 raw markdown。
- 實作：用既有 markdown→HTML render（或輕量套件）；複製用 Clipboard API 寫 `text/html` + `text/plain` 兩種 MIME。
- 封面圖、SEO 欄位、音檔內嵌：v1 由 Tommy 在 Substack 後台手動填/貼（按鈕旁顯示「待填欄位」清單）。

---

## 4. 範圍與 YAGNI

**納入（v1）**
- review page 按鈕、產草稿、dashboard review/編輯、複製貼上發佈、`substack_drafts` table。

**不納入（v1，日後可加）**
- 非官方 cookie API 自動推草稿 / 自動發佈
- 封面圖自動化（模板 autofill：Templated.io / Canva Autofill，見 §2.5）
- Notes 自動產生 / 自動發（先手動，沿用 Threads 素材）
- RSS 反向自動轉發 Threads/IG
- 自訂網域、付費訂閱、自動排程

---

## 5. 測試 / 驗證
- `cd dashboard && npm run build` 通過
- 對一集真實 episode 跑產草稿，檢查：模板結構、繁中、SEO 標題/描述、無 AI 腔
- 草稿編輯後重讀，確認持久化
- 複製貼進 Substack 編輯器實測格式保真
