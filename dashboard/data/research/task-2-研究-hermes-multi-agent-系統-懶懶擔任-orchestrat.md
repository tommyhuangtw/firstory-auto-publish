# 研究 Hermes Multi-Agent 系統：懶懶擔任 Orchestrator

## 概述

本研究探討如何讓懶懶從目前單一 AI 助手角色，升級為 AI Agent Team 的 orchestrator（指揮官），管理底下多個專業 agent：資深行銷專員、社群小編、內容企劃、工程師等。目標是讓 AI 懶人報的社群經營（IG、Threads、YouTube）和 Podcast 產製更自動化、更有策略性。

---

## 現狀分析：已有的三 Agent 系統

目前系統已有初步的多 agent 架構：

| Agent | 角色 | 職責 |
|-------|------|------|
| **小企** | Planner Agent | 趨勢分析 + 內容提案 |
| **懶懶** | PM Agent | 評估提案、審核成果、review digest、daily summary |
| **小工** | Engineer Agent | 執行任務（Claude Code）、切 branch、跑測試 |

### 現有流程

```
Orchestrator (cron 觸發)
  ├── Morning: 小企提案 → 懶懶評估 → 小工執行 → digest
  └── Evening: 小工執行 → 懶懶審核 → digest → daily summary

Task Execution:
  小工抓 todo + auto_execute=1 的任務
  → 切 feat/task-{id} branch
  → 執行 claude -p (最多 30 turns / 15 min)
  → status=review
  → 懶懶審核 → 留在 board → 隔天早上彙整進老闆快報
```

### 現有局限

1. **Agent 角色太少** — 只有企劃/PM/工程師三種，缺乏社群策略、行銷、數據分析等專業角色
2. **決策層級扁平** — 懶懶同時是 PM 又兼 orchestrator，缺少策略層的建議
3. **執行方式單一** — 全都走 Claude Code CLI，不適合內容創作類任務
4. **缺少回饋迴圈** — 內容發布後的表現數據沒有自動回饋到選題策略

---

## 建議架構：懶懶 Orchestrator

### 核心設計原則

1. **懶懶是指揮官，不是執行者** — 專注在策略判斷、任務分派、品質把關
2. **專業 agent 各司其職** — 每個 agent 有明確的擅長領域和執行工具
3. **雙層審核機制** — agent 自審 + 懶懶複審，風險高的才上報 Tommy
4. **數據驅動迭代** — 社群表現數據自動回饋到選題和內容策略

### Agent 角色定義

```
                   ┌─────────────┐
                   │    Tommy    │
                   │  (老闆/最終審核) │
                   └──────┬──────┘
                          │ 只有高風險/需拍板的事
                   ┌──────▼──────┐
                   │  懶懶 Orchestrator │
                   │ 策略指揮・品質總監 │
                   └──┬──┬──┬──┬──┘
                      │  │  │  │
         ┌────────────┘  │  │  └────────────┐
         │               │  │               │
   ┌─────▼─────┐  ┌─────▼──▼─────┐  ┌─────▼─────┐
   │  小企      │  │   小工       │  │  新角色們   │
   │ Planner   │  │  Engineer    │  │  See below  │
   └───────────┘  └──────────────┘  └───────────┘
```

#### 1. 小企 — 內容策略企劃（已存在）

**核心能力：** 趨勢雷達、選題提案、內容日曆規劃
**工具：** YouTube Data API、Google Trends、RSS feed、n8n
**職責：**
- 每天掃描 AI 產業新聞和社群熱點
- 提出下週內容日曆（Podcast 主題 + 社群貼文方向）
- 評估每個主題的搜尋潛力和競爭程度
- 季度策略回顧：哪些內容類型表現好，哪些需調整

#### 2. 小工 — 工程執行（已存在）

**核心能力：** 程式開發、Pipeline 操作、測試驗證
**工具：** Claude Code CLI、Git、npm、Playwright
**職責：**
- 執行技術類任務（新功能開發、bug fix）
- Pipeline 監控與故障排除
- 數據爬蟲與報表生成
- Branch 管理與 PR 建立

#### 3. 新角色：行銷專員（Marketing Specialist）

**核心能力：** 社群文案、漏斗設計、A/B 測試
**工具：** 懶懶的 voice-writer、Threads API、IG Graph API
**職責：**
- 將 Podcast 內容轉換為多平台社群貼文
- 針對不同平台（Threads/IG/FB/YouTube）優化文案風格
- 設計內容漏斗：曝光層 → 互動層 → 轉換層（官網/Sponsor）
- 執行 A/B 測試（標題、縮圖、發文時間）

#### 4. 新角色：數據分析師（Data Analyst）

**核心能力：** 數據洞察、表現歸因、趨勢預測
**工具：** SQLite、Python（pandas/matplotlib）、SoundOn API
**職責：**
- 每週產出社群表現報表（哪種內容策略最有效）
- 分析聽眾/粉絲行為模式（最佳發文時間、內容偏好）
- 歸因分析：哪篇貼文帶動了 Podcast 收聽
- 預測模型：哪些主題在未來一週有潛在爆文機會

#### 5. 新角色：內容編輯（Content Editor）

**核心能力：** 腳本優化、SEO、品牌語調一致性
**工具：** LLM（Gemini/Claude）、SEO tools
**職責：**
- Podcast 腳本品質把關（流暢度、資訊正確性、引人入勝程度）
- YouTube 標題 SEO 優化
- 確保所有輸出符合「AI 懶人報」品牌語調
- 長文內容（Blog、Newsletter）改寫與發布

---

## Orchestrator 排程設計

### 每日流程

```
08:00 ─ 小企出報：掃描 overnight 新聞 + 社群熱點 → 提案 3-5 個主題
08:15 ─ 懶懶審提案：選定今日主題、指派給對應 agent
09:00 ─ 各 agent 執行（平行作業）
          ・小工：Pipeline 啟動 / 技術任務
          ・行銷專員：Threads 今日貼文產生 + 排程
          ・內容編輯：Podcast 腳本品質檢查
14:00 ─ 懶懶 mid-day check：各 agent 進度確認
20:00 ─ 收尾彙報：
          ・數據分析師：今日表現摘要
          ・懶懶：明日 preview + 需 Tommy 決定事項
```

### 風險分級閘門

| 等級 | 類型 | 處理方式 |
|------|------|---------|
| **auto_do** | 低風險、高回饋 | 懶懶審核後直接執行，不需 Tommy |
| **ask_boss** | 高風險、需決策 | 懶懶附 pros/cons 建議，送 Tommy Telegram 批准 |
| **emergency** | Pipeline 故障、異常 | 直接通知 Tommy（附 root cause + 建議修復方式） |

---

## 現有系統整合方案

### 與現有 Kanban 整合

目前的 Task Board 已經有 status/category/priority/auto_execute 等字段，可以直接支援：

- **category** 欄位對應 agent 類型（content → 行銷專員、infra → 小工、research → 小企）
- **auto_execute=1** 為 auto_do 任務
- **ask_boss** 用新 tag 或 priority=urgent 標記
- 每張 ticket 的 comment thread 作為 agent 間的溝通記錄

### 與現有 NotificationHub 整合

NotificationHub 已經有事件派發機制，可以擴充：

- 新增 `agent.task.assigned` / `agent.task.completed` / `agent.task.needs_review` 事件
- 懶懶 orchestrator 作為事件監聽者，決定下一步動作
- 重大事件推送到 Telegram（老闆快報模式）

### 與現有 MCP Tools 整合

Hermes MCP Server 已有 ~40 個 tools，各 agent 可透過 MCP 操作系統：

- 小工：pipeline、git、task tools
- 行銷專員：threads、episode tools
- 數據分析師：analytics、metrics tools

---

## 實作路徑建議

### Phase 1：架構驗證（1-2 天）
1. 定義新 agent 角色的 interface 和職責範圍
2. 建立懒懶 orchestrator 的排程邏輯（從現有 orchestrator.ts 擴充）
3. 實作一個新角色（建議行銷專員，因為已有 voice-writer 可接）

### Phase 2：核心功能（3-5 天）
1. Agent 間通訊機制（comments / 共享 context）
2. 風險分級自動化（auto_do vs ask_boss 判斷邏輯）
3. 平行任務執行支援

### Phase 3：優化迭代（持續）
1. 數據回饋迴圈（表現數據 → 自動調整選題策略）
2. Agent 記憶共享（跨 session 的經驗學習）
3. 自適應排程（根據歷史表現動態調整每日流程）

---

## 關鍵建議

1. **不急著一次做完** — Phase 1 只要擴充一個新角色就夠，先驗證 orchestrator 模式可行
2. **行銷專員最優先** — 因為 voice-writer + Threads API 已經到位，加上去立刻能看到產出
3. **保留人工閘門** — 不要讓 agent 有最終發布權限，這會讓 Tommy 失去掌控感
4. **數據分析師最後加** — 需要有足夠的歷史數據才能產出有意義的 insight
5. **懶懶的定位要明確** — 是指揮官不是執行者，否則會跟以前一樣所有事都卡在懶懶身上
