# 記憶架構 — AI 懶人報 Podcast 自動化系統

> 全自動 Podcast 產製系統的記憶架構文件。涵蓋跨集記憶、工具追蹤、主題演化、里程碑保存等完整記憶系統設計。

---

## 1. 架構總覽

記憶系統分為 **五層**，每層各司其職：

```
┌─────────────────────────────────────────────────────────┐
│                   腳本生成（Script Generation）            │
│         (buildMemoryContext → 注入 LLM prompt)            │
└─────────────────────┬───────────────────────────────────┘
                      │ 讀取
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │  第一層   │  │  第二層   │  │  第三層   │
  │  工具記憶 │  │  集數摘要 │  │  主題追蹤 │
  └──────────┘  └──────────┘  └──────────┘
        │             │             │
        │       ┌─────┴─────┐      │
        │       ▼           ▼      │
        │  ┌─────────┐ ┌────────┐  │
        │  │里程碑標記│ │常青標記 │  │
        │  └─────────┘ └────────┘  │
        │                          │
        └──────────┬───────────────┘
                   ▼
         ┌──────────────────┐
         │   時間衰退機制     │
         │ （依單元類型設定    │
         │   滾動記憶窗口）   │
         └──────────────────┘
```

### Pipeline 中的資料流

```
fetchYoutube → classify → scriptEnglish → extractTools → translate → ...
                               │               │
                     buildMemoryContext()       │
                     （讀取過去的摘要、           ├── extractToolsFromScript()
                       主題、工具、              ├── generateEpisodeDigest()
                       里程碑）                  └── extractAndUpsertThemes()
```

**核心原則**：記憶上下文是在腳本生成**之前**透過輕量級 DB 查詢預先取得（不耗費 LLM 成本）。寫入路徑（摘要/主題擷取）發生在腳本生成**之後**，所以它餵給的是*下一集*，而不是當前這集。

---

## 2. 第一層 — 工具記憶

### 用途
追蹤 AI 工具在各集出現的頻率與演化，讓 LLM 知道觀眾對哪些工具已經熟悉，避免重複介紹。

### 相關檔案
- `services/memory/toolExtractor.ts` — 第一層：LLM 擷取 + 後處理
- `services/memory/toolFamilies.ts` — 實體解析（地名辭典式 regex 模式匹配）
- `services/memory/memoryService.ts` — 第二層：儲存、壓縮、上下文建構

### 資料庫表格

```sql
-- 76 組預設的 regex 模式，用於 AI 工具家族比對
tool_families (family_name, pattern, canonical_display, category)

-- 個別工具的記憶追蹤
tools (
  canonical_name TEXT UNIQUE,     -- "Claude", "ChatGPT", "Cursor"
  aliases TEXT,                   -- JSON 陣列：["Claude AI", "Anthropic Claude"]
  category TEXT,                  -- "LLM" | "DevTool" | "Image" | ...
  mention_count INTEGER,          -- 跨集累計提及次數
  current_summary TEXT,           -- ≤300 字元，LSM-tree 壓縮後的摘要
  summary_version INTEGER,        -- 每次壓縮時遞增
  latest_version_detail TEXT,     -- "Opus 4.6", "4o", "3.5 Sonnet"
  family_id INTEGER,              -- FK → tool_families
  first_seen_date TEXT,           -- "2026-04-20"
  latest_seen_date TEXT           -- "2026-05-22"
)

-- 每集的工具提及紀錄，含重要性評分
episode_tool_mentions (
  episode_id INTEGER,
  tool_id INTEGER,
  mention_type TEXT,              -- "new" | "update" | "deep_dive" | "brief"
  context_snippet TEXT,           -- 1-2 句摘要，描述腳本中提到了什麼
  significance REAL,              -- 0.0-1.0 IDF 啟發式評分
  version_detail TEXT,            -- 本集提到的特定版本
  aired_date TEXT
)
```

### 擷取流程

```
英文腳本
     │
     ▼
LLM 擷取（Gemini Flash Lite）
     │  擷取：name, category, aliases, contextSnippet,
     │        mentionType, isStandaloneProduct
     ▼
黑名單過濾（O(1) Set 查詢）
     │  移除：程式語言、YouTube 頻道、
     │        通用概念、自我引用（約 60 筆）
     ▼
家族解析（regex 地名辭典）
     │  "Claude Opus 4.6" → 家族 "Claude"，版本 "Opus 4.6"
     │  "Claude Code" → 獨立產品（保留原名）
     ▼
去重複（依 canonical name）
     │
     ▼
重要性評分（4 個信號，加權求和）
     │  信號 1：提及深度（40%）— deep_dive > update > new > brief
     │  信號 2：時間衰退（30%）— 超過 60 天未出現 → 加分
     │  信號 3：逆向頻率（20%）— IDF 啟發式
     │  信號 4：版本變更（10%）— 新版本值得關注
     ▼
DB 更新插入 + 摘要壓縮（當 mention_count ≥ 3）
```

### 摘要壓縮（LSM-tree 啟發式）

當工具被提及 3 次以上時，透過 LLM 壓縮其 `current_summary`：

```
舊摘要 + 新上下文 → LLM → 合併後的摘要（≤300 字元）
```

這防止了無限增長，同時保留關鍵的演化細節。

### 上下文注入

在腳本生成時，`buildMemoryContext()` 將影片標題/逐字稿與已知工具比對，產生簡報：

```
觀眾記憶上下文 — 以下工具/公司在過去的集數中已被介紹過：

- ChatGPT（非常熟悉，15次）— 上次討論版本：GPT-4o
  過去報導：OpenAI 的旗艦聊天機器人...
- Cursor（曾提及，3次）— 上次討論版本：0.45
  [已 45 天未提及 — 適合簡短複習]

指示：
- 對於非常熟悉的工具（5+ 次提及）：不要解釋它是什麼。
- 對於超過 30 天未提及的工具：適合簡短複習。
- 絕對不要用集數編號引用過去的集數。
```

### 工具記憶的時間衰退

超出該單元記憶窗口的工具會被排除在上下文注入之外，**例外**是「非常熟悉」的工具（10+ 次提及），它們始終保留最小條目。

```typescript
// 在 buildMemoryContext() 中：
if (daysSinceLast > toolWindowMonths * 30 && tool.mention_count < 10) {
  return false; // 已衰退 — 超出窗口且不夠知名
}
```

---

## 3. 第二層 — 集數摘要（Episode Digests）

### 用途
每集產生結構化摘要，讓後續各集知道「上週聊了什麼」，實現跨集敘事連續性。

### 相關檔案
- `services/memory/digestService.ts` — `generateEpisodeDigest()`

### 資料庫表格

```sql
episode_digests (
  episode_id INTEGER NOT NULL,
  segment_type TEXT NOT NULL,          -- "daily" | "weekly" | "quickchat" | ...
  thesis TEXT NOT NULL,                -- 1-2 句核心論點（≤200 字元）
  key_insights TEXT NOT NULL,          -- JSON：["洞察1", "洞察2", ...]
  tools_covered TEXT NOT NULL,         -- JSON：["Cursor", "Claude Code", ...]
  open_threads TEXT NOT NULL,          -- JSON：["自主編程會取代初級工程師嗎？"]
  digest_text TEXT NOT NULL,           -- 完整編譯摘要（≤400 字元）
  aired_date TEXT NOT NULL,
  is_milestone INTEGER DEFAULT 0,     -- 1 = 重大事件，不受時間衰退影響
  milestone_label TEXT                 -- "Claude Code 首次推出"
)
```

### 運作方式

1. **觸發時機**：在 pipeline 階段 3.5（`extractTools` 節點），工具擷取之後，適用於**所有單元類型**
2. **輸入**：英文腳本（前 6000 字元）
3. **LLM 呼叫**：Gemini Flash Lite 產生結構化 JSON 摘要
4. **冪等性**：若該 episode_id 已存在摘要則跳過
5. **里程碑偵測**：LLM 評估該集是否涵蓋里程碑事件

### 里程碑標準

只有真正的里程碑事件才符合條件：

| 類型 | 範例 |
|------|------|
| 重大產品首次發布 | "Claude Code 首次推出"、"GPT-3.0 發布" |
| 典範轉移 | "首個開源模型擊敗 GPT-4" |
| 重大收購/關閉 | "Google 收購 X"、"某服務停止運營" |
| 產業定義性時刻 | "AI 通過律師考試"、"達到 10 億用戶" |

大多數集數都**不是**里程碑。標準刻意設得很高。

### 上下文注入

`buildDigestContext(segmentType)` 查詢該單元記憶窗口內的近期摘要：

```
集數連貫性上下文 — 你的聽眾最近聽過的集數：

[EP67, 2026-05-21] AI 編程助手正從自動補全轉向自主代理
  未結線索：自主編程會取代初級工程師嗎？

[週報 EP66, 2026-05-19] AI 影片生成本週跨越了恐怖谷
  未結線索：好萊塢將如何回應？

指示：
- 自然地引用這些主題："我們一直在追蹤..."、"如同我們最近討論的..."
- 在相關時延續未結線索
- 不要引用集數編號
- 在相關時跨單元交叉引用
```

---

## 4. 第三層 — 主題追蹤（Theme Tracker）

### 用途
追蹤跨集反覆出現的主題（如「AI 編程助手」），用 LSM-tree 壓縮法維護主題的演化敘事摘要。

### 相關檔案
- `services/memory/digestService.ts` — `extractAndUpsertThemes()`、`compactThemeSummary()`

### 資料庫表格

```sql
-- 反覆出現的主題，含壓縮後的摘要
themes (
  theme_name TEXT UNIQUE NOT NULL,     -- "AI Coding Assistants"
  category TEXT,                       -- "AI Coding" | "Robotics" | "LLM Models" | ...
  current_summary TEXT,                -- ≤500 字元，LSM-tree 壓縮的敘事弧線
  summary_version INTEGER DEFAULT 1,
  episode_count INTEGER DEFAULT 1,
  first_episode_id INTEGER,
  latest_episode_id INTEGER,
  first_seen_date TEXT,
  latest_seen_date TEXT,
  is_evergreen INTEGER DEFAULT 0       -- 1 = 長期重大趨勢，不受時間衰退影響
)

-- 關聯表：哪些主題出現在哪些集數中
episode_themes (
  episode_id INTEGER,
  theme_id INTEGER,
  relevance REAL,                      -- 0.0-1.0
  context_snippet TEXT,                -- 這集如何與該主題相關
  UNIQUE(episode_id, theme_id)
)
```

### 主題擷取流程

1. **輸入**：英文腳本 + 現有主題清單（用於去重複）
2. **LLM 呼叫**：辨識每集 2-5 個主題
3. **匹配**：優先重用現有主題名稱
4. **更新插入**：建立新主題或遞增 `episode_count`
5. **壓縮**：提及 3 次以上後，對 `current_summary` 進行 LSM-tree 合併（≤500 字元）
6. **常青升級**：自動將跨度超過 6 個月且出現超過 8 集的主題升級為常青

### 主題分類

```
"AI Coding" | "LLM Models" | "AI Media" | "Robotics" | "System Design" |
"AI Business" | "AI Ethics" | "Developer Tools" | "AI Research" | "Other"
```

### 主題壓縮（LSM-tree）

與工具摘要壓縮相同的模式，但針對敘事弧線最佳化：

```
前次：「AI 編程工具從自動補全開始（Copilot，2021）」
新上下文：「Claude Code 引入自主多檔案編輯功能」
    ↓ LLM 合併 ↓
壓縮後：「從自動補全起步（Copilot），演進到多檔案編輯
（Cursor），現在是自主代理（Claude Code）。核心張力：
生產力提升 vs 開發者技能退化。」
```

### 常青自動升級

```typescript
// 跨度超過 6 個月 且 出現超過 8 集 → 自動升級
if (row.episode_count > 8) {
  const spanDays = /* 從 first_seen_date 到 latest_seen_date 計算 */;
  if (spanDays > 180) {
    db.prepare('UPDATE themes SET is_evergreen = 1 WHERE id = ?').run(row.id);
  }
}
```

### 上下文注入

`buildThemeContext(segmentType)` 查詢活躍主題（在窗口內 或 常青）：

```
聽眾一直在關注的反覆主題：

- AI 編程助手（12 集）：從自動補全起步，演進到多檔案編輯，
  現在是自主代理...
- 開源 vs 閉源 AI（8 集，常青）：開放權重與專有模型之間的
  策略性張力...
```

---

## 5. 第四層 — 里程碑記憶

### 用途
重大歷史事件永久保存，不受時間衰退影響。讓 LLM 可以用「距離 Claude Code 推出還不到一年...」的方式提供歷史脈絡。

### 相關檔案
- `services/memory/digestService.ts` — `buildMilestoneContext()`

### 儲存方式
里程碑以旗標形式儲存在 `episode_digests` 表格中：
- `is_milestone = 1`
- `milestone_label = "Claude Code launched"`

### 上下文注入

```
歷史里程碑（供聽眾視角參考）：

- [2025-06] Claude Code 首次作為 CLI 工具推出
- [2025-11] GPT-3.0 發布，支援原生多模態
- [2026-02] 首個開源模型在所有基準測試上超越 GPT-4

用這些來提供歷史視角："距離 Y 發生已經 X 個月了，而現在已經..."
```

里程碑**始終可見**於所有單元類型，不受記憶窗口限制。

---

## 6. 時間衰退 — 依單元類型的滾動窗口

### 設計原則

記憶有時效性。大部分內容在幾個月後就不再相關，但里程碑和長期趨勢需要永久保留。每個單元類型有自己的記憶窗口。

### 單元記憶配置

```typescript
const SEGMENT_MEMORY_CONFIG = {
  daily:     { ownWindowMonths: 2, crossSegments: [{weekly, 2}, {quickchat, 1}] },
  weekly:    { ownWindowMonths: 2, crossSegments: [{daily, 5},  {quickchat, 1}] },
  quickchat: { ownWindowMonths: 2, crossSegments: [{daily, 3},  {weekly, 1}]    },
  robot:     { ownWindowMonths: 2, crossSegments: [{daily, 2}], themeFilter: 'Robotics' },
  sysdesign: { ownWindowMonths: 3, crossSegments: [],           themeFilter: 'System Design' },
};
```

### 記憶可見性矩陣

| 單元 | 自身摘要 | 跨單元 | 主題 | 工具記憶 | 里程碑 |
|------|---------|--------|------|---------|--------|
| `daily` 日報 | 2 個月 | 2 週報 + 1 碎碎念 | 全部（2 個月） | 有（2 個月） | 全部時間 |
| `weekly` 週報 | 2 個月 | 5 日報 + 1 碎碎念 | 全部（2 個月） | 有（2 個月） | 全部時間 |
| `quickchat` 碎碎念 | 2 個月 | 3 日報 + 1 週報 | 全部（2 個月） | 有（2 個月） | 全部時間 |
| `robot` 機器人週報 | 2 個月 | 2 日報 | 僅 Robotics（2 個月） | 有（2 個月） | 全部時間 |
| `sysdesign` 系統設計 | 3 個月 | 無 | 僅 System Design（3 個月） | 無 | 全部時間 |

### 什麼能存活過時間衰退

| 資料類型 | 衰退規則 | 例外 |
|---------|---------|------|
| 集數摘要 | 超出單元窗口 → 排除 | `is_milestone = 1` → 永久保留 |
| 主題 | 超出單元窗口 → 排除 | `is_evergreen = 1` → 永久保留 |
| 工具記憶 | 超出單元窗口 → 排除 | `mention_count >= 10` → 保留最小條目 |
| 里程碑 | 永不衰退 | — |

### 實作方式

```sql
-- 窗口內的摘要
WHERE d.aired_date >= date('now', '-' || ? || ' months')

-- 窗口內的主題 或 常青主題
WHERE (t.latest_seen_date >= date('now', '-' || ? || ' months') OR t.is_evergreen = 1)

-- 帶衰退的工具記憶
-- 在 TypeScript 中：
if (daysSinceLast > toolWindowMonths * 30 && tool.mention_count < 10) {
  return false; // 已排除
}
```

---

## 7. Pipeline 整合

### 寫入路徑（階段 3.5：`extractTools` 節點）

```
scriptEnglish 輸出
       │
       ▼
extractTools（pipeline 節點）
       │
       ├── [1] extractToolsFromScript()     ← sysdesign/quickchat 跳過
       │        └── upsertTools()
       │
       ├── [2] generateEpisodeDigest()       ← 所有單元類型都執行
       │
       └── [3] extractAndUpsertThemes()      ← 所有單元類型都執行
```

### 讀取路徑（階段 3：`scriptEnglish` 節點）

```
buildMemoryContext(videoTexts, episodeId, segmentType)
       │
       ├── 工具匹配（DB 掃描，無 LLM 成本）
       │     └── 套用時間衰退
       │
       ├── buildDigestContext(segmentType)
       │     ├── 自身單元的摘要（窗口內）
       │     └── 跨單元摘要（依配置）
       │
       ├── buildThemeContext(segmentType)
       │     └── 活躍 + 常青主題
       │
       └── buildMilestoneContext()
             └── 所有里程碑，全部時間
```

### 注入系統提示詞的結構

```
[該單元類型的基礎系統提示詞]

---

觀眾記憶上下文 — [工具熟悉度簡報]
指示：[不要重複解釋已知工具...]

---

集數連貫性上下文 — [近期摘要與未結線索]
反覆主題 — [活躍主題摘要]
歷史里程碑 — [永久保存的重大事件]
指示：[自然引用、延續未結線索...]
```

### 同時注入的其他節點

| 節點 | 注入內容 | 用途 |
|------|---------|------|
| `translate.ts` | `briefForScriptGen` | 防止翻譯器過度解釋已知工具 |
| `qualityScore.ts` | `briefForQualityCheck` | 若腳本重新解釋已知工具則扣分 |

---

## 8. 成本分析

| 操作 | 模型 | Token 數 | 每集成本 | 頻率 |
|------|------|---------|---------|------|
| 工具擷取 | Gemini Flash Lite | ~8000 入 / 2048 出 | ~$0.002 | 每集（daily/weekly/robot） |
| 工具摘要壓縮 | Gemini Flash Lite | ~300 入 / 256 出 | ~$0.001 | 當 `mention_count ≥ 3` |
| 集數摘要 | Gemini Flash Lite | ~6000 入 / 1024 出 | ~$0.001 | 每集（所有類型） |
| 主題擷取 | Gemini Flash Lite | ~5000 入 / 1024 出 | ~$0.002 | 每集（所有類型） |
| 主題壓縮 | Gemini Flash Lite | ~500 入 / 384 出 | ~$0.001 | 當 `episode_count ≥ 3` |
| **上下文建構** | **無（DB 掃描）** | **0** | **$0** | **每集** |

**總記憶成本**：每集約 $0.005-0.007 → 以每日製作頻率計算，**每月約 $3-4**。

**無外部基礎設施**：所有東西都跑在 SQLite 上。不需要向量資料庫、圖資料庫、或 embedding API。

---

## 9. 設計決策與取捨

### 為什麼不用 Vector RAG？

語料庫約 70 集 × 3000 字 = 約 280K tokens。可以完全放進一個上下文窗口。Vector search 會增加：
- Embedding 模型選擇與版本更迭（每 6-12 個月需重新索引）
- 分塊策略（破壞集數層級的敘事結構）
- 機率性檢索（2026 年業界數據：73% 的 RAG 失敗是檢索失敗）
- 基礎設施成本（$20-70/月 向量資料庫）

在預計算摘要上的確定性 SQL 查詢更可靠、更易除錯、而且免費。

### 為什麼不用 Graph RAG？

查詢是時間性的（「上週我們討論了什麼？」）和主題性的（「反覆出現的 AI 趨勢」），不是多跳關聯式的（「X 公司 CEO 的雇主是誰？」）。Graph RAG 有：
- 10-40 倍的索引成本
- 每新增一集都需要強制重新索引
- 實作複雜度：4-12 週 vs 1-2 週

### 為什麼用 SQLite 而不是 Neo4j？

不到 200 個實體、不到 100 集。SQLite 的鄰接表提供 O(1) 查詢和交易安全性，不需要另外維護一個圖資料庫。當實體數量超過約 10K 時，遷移到 Neo4j 才有意義。

### 為什麼不用 Obsidian/Markdown（Karpathy 風格）？

採用了他的**心智模型**（LLM 即編譯器：原始內容 → 結構化知識），但不用 Markdown 作為儲存格式。使用者是自動化 pipeline 中的另一個 LLM，不是在 Obsidian 中瀏覽的人類。SQLite 提供了 Markdown 檔案無法提供的時間查詢、單元類型過濾和交易安全性。

### 規模擴展轉折點

| 規模 | 行動 |
|------|------|
| 約 500 集 | 在 `digest_text` 上加入向量嵌入，用於語義主題匹配 |
| 約 2000 集 | 遷移到 PostgreSQL + pgvector |
| 約 10K 集 | 考慮 Neo4j 用於多跳實體遍歷 |

---

## 10. 檔案對照表

| 檔案 | 層 | 用途 |
|------|---|------|
| `services/memory/toolExtractor.ts` | 工具記憶 | LLM 擷取 + 黑名單 + 家族解析 + 重要性評分 |
| `services/memory/toolFamilies.ts` | 工具記憶 | 76 組 regex 模式用於實體去重、黑名單 |
| `services/memory/memoryService.ts` | 工具記憶 + 協調層 | 工具更新插入、摘要壓縮、`buildMemoryContext()` 協調器 |
| `services/memory/digestService.ts` | 摘要 + 主題 + 里程碑 | 摘要生成、主題擷取/壓縮、上下文建構函式 |
| `pipeline/nodes/extractTools.ts` | Pipeline 整合 | 階段 3.5：呼叫工具擷取 + 摘要 + 主題擷取 |
| `pipeline/nodes/scriptEnglish.ts` | Pipeline 整合 | 階段 3：呼叫 `buildMemoryContext()`，注入 LLM 提示詞 |
| `pipeline/nodes/translate.ts` | Pipeline 整合 | 將工具簡報注入翻譯提示詞 |
| `pipeline/nodes/qualityScore.ts` | Pipeline 整合 | 將工具簡報注入品質評分提示詞 |
| `db/schema.sql` | 儲存層 | 所有記憶相關表格的定義 |
