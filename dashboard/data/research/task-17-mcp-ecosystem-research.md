# MCP 生態系爆發期深度研究：誰在贏、怎麼用、對聽眾的影響

## 研究目的

深度調研 Model Context Protocol (MCP) 目前的生態發展，包括：主要 MCP server 分類、各大平台支援狀態、實際好用的 MCP server Top 10、安全疑慮、以及對非開發者的意義。本研究同時作為 Podcast episode 選題素材，並更新我們自己的工具記憶系統。

---

## 1. MCP 是什麼？為什麼突然爆發？

### 一句話解釋

MCP（Model Context Protocol）是 AI 模型連接外部工具的「USB-C 標準」。就像 USB-C 讓所有裝置用同一條線充電，MCP 讓所有 AI 助手用同一個協定連接任何工具、資料庫、API。

### 時間線：從實驗到產業標準

| 時間 | 里程碑 | SDK 月下載量 |
|------|--------|-------------|
| 2024/11 | Anthropic 發布 MCP 開源標準 | ~200 萬 |
| 2025/03 | **OpenAI 加入**：Sam Altman 發文「People love MCP」 | — |
| 2025/04 | Google DeepMind 確認 Gemini 將支援 MCP | — |
| 2025/05 | OpenAI 支援 Remote MCP servers | 2,200 萬 |
| 2025/07 | **Microsoft** 整合至 Copilot Studio | 4,500 萬 |
| 2025/09 | OpenAI 在 ChatGPT Apps 加入 MCP 支援 | — |
| 2025/11 | **AWS** 加入；規格大更新（非同步、Stateless、Server Identity） | 6,800 萬 |
| 2025/12 | **Anthropic 捐贈 MCP 給 Linux Foundation**（AAIF） | — |
| 2026/01 | Claude 推出 MCP Apps（UI 預覽 + 互動元素） | — |
| 2026/03 | 2026 Roadmap 發布；**30 個 CVE 在 60 天內被揭露** | 9,700 萬 |
| 2026/04 | MCP Dev Summit 紐約，1,200 人參加 | — |
| 2026/05 | **9,652 個 Registry 伺服器**；GitHub 15,926 個相關 repo | 9,700 萬+ |

**關鍵轉折點**：2025 年 3 月 OpenAI 宣布支援 MCP。在此之前，MCP 只是 Anthropic 自家的協定；OpenAI 加入後，它從「一家公司的標準」變成「整個產業的基礎設施」。

### 治理結構

2025 年 12 月，Anthropic 將 MCP 捐贈給 Linux Foundation 旗下的 **Agentic AI Foundation (AAIF)**，共同創辦者包括 Anthropic、Block（Square 母公司）和 OpenAI，其他支持者有 Google、Microsoft、AWS。

- **治理方式**：Working Groups + Interest Groups
- **變更機制**：Spec Enhancement Proposals (SEPs)
- **貢獻者階梯**：社區參與者 → WG 貢獻者 → WG 主持人 → Lead Maintainer → Core Maintainer
- **意義**：MCP 不再是任何一家公司的產品決策，而是社區驅動的開放標準

---

## 2. 各大平台 MCP 支援狀態

### AI 編碼工具

| 平台 | MCP 支援程度 | 特色 |
|------|-------------|------|
| **Claude Code / Desktop** | ★★★★★ 最成熟 | 原生雙向 MCP 通訊，2026/01 推出 MCP Apps（UI 互動） |
| **Cursor** | ★★★★ 完整 | 社區 connectors（GitHub、Linear、Notion、Postgres），需手動設定 `.cursor/mcp.json` |
| **Windsurf** | ★★★★ 完整 | 策展式 MCP servers，與 Cursor 大致平等 |
| **GitHub Copilot** | ★★★★ 完整 | VS Code 整合 MCP，Agent Mode 支援 |
| **OpenAI Codex** | ★★ 有限 | 不支援 MCP，可擴展性受限 |

### AI 對話工具

| 平台 | MCP 支援 |
|------|----------|
| **ChatGPT Desktop** | 2025/09 起支援（ChatGPT Apps） |
| **Claude Desktop** | 最早支援，最完整 |
| **Gemini** | 2025/04 確認支援 |
| **Microsoft Copilot** | 透過 Copilot Studio 整合 |

### 企業平台

Salesforce、HubSpot、Jira、Slack、Notion 等主流 SaaS 工具均已推出官方或社區 MCP server，反映企業端第二波部署浪潮。

---

## 3. MCP Server 分類與 Top 10 推薦

### 分類總覽

根據多個排行榜和社區數據，MCP server 可分為以下主要類別：

| 類別 | 伺服器數量 | 代表 |
|------|-----------|------|
| 開發工具 | 1,200+ | GitHub、Playwright、Context7 |
| 資料分析 & 資料庫 | 950+ | Postgres、BigQuery、Snowflake |
| 企業整合 | 800+ | Slack、Notion、Jira、HubSpot |
| 網頁搜尋 & 爬蟲 | 500+ | Brave Search、Firecrawl、Octoparse |
| 內容 & 行銷 | 300+ | WordPress、Figma、Canva |
| 通訊 | 200+ | Slack、Discord、Intercom |
| 電商 | 150+ | Shopify、Stripe |
| 設計 | 100+ | Figma、Canva |

### Top 10 最受歡迎 MCP Servers（2026 年 5 月）

根據 FastMCP/MCP Directory 的真實數據排名：

| 排名 | 名稱 | 用途 | 為什麼受歡迎 |
|------|------|------|-------------|
| 1 | **Context7** | 注入版本對應的程式碼文檔到 AI prompt | 解決 AI 用舊版文檔寫錯 code 的痛點，遙遙領先第二名（11,000 views） |
| 2 | **Playwright** | 瀏覽器自動化 | 讓 AI 直接操控瀏覽器做測試/爬資料 |
| 3 | **Brave Search** | 即時搜尋 | 無 Google 追蹤、無廣告偏差的搜尋引擎 |
| 4 | **Firecrawl** | 網頁爬蟲 + 結構化資料 | 一步搜尋+抓取，回傳乾淨結構化資料 |
| 5 | **Filesystem** | 本地檔案系統 | 讓 AI 直接讀寫檔案 |
| 6 | **Postgres** | 資料庫操作 | 讓 AI 直接查詢/分析資料庫 |
| 7 | **GitHub** | 程式碼管理 | Issues、PRs、Repo 操作 |
| 8 | **Slack** | 團隊通訊 | 搜尋頻道歷史、發訊息 |
| 9 | **Notion** | 筆記 & 知識庫 | OAuth 式資料庫/頁面管理 |
| 10 | **Docker** | 容器管理 | 建立/管理容器環境 |

**跨平台相容性最好的 5 個**：GitHub、Context7、Playwright、Filesystem、Brave Search — 這五個在所有主要 MCP client 都能運作。

---

## 4. 技術架構演進：從本地到雲端

### 本地 vs. 遠端

MCP 最大的技術轉變是從 **stdio（本地行程）** 轉向 **Streamable HTTP（遠端伺服器）**。

| 面向 | stdio（本地） | Streamable HTTP（遠端） |
|------|-------------|----------------------|
| 部署 | 裝在自己電腦 | 部署到雲端 |
| 使用門檻 | 需要 Node.js/Python | 一個 URL 就能連接 |
| 適合對象 | 開發者 | 所有人 |
| 擴展性 | 單機 | 多用戶共用 |
| 安全性 | 相對封閉 | 需要 OAuth/認證 |

遠端部署的增長速度是本地的 **4 倍**（自 2025 年 5 月以來）。

### 免費部署平台

| 平台 | 免費額度 | 特色 |
|------|---------|------|
| **Cloudflare Workers** | 10 萬 requests/天 | 300+ 邊緣節點，近零冷啟動 |
| **Vercel Functions** | Hobby tier | Fluid compute 動態擴展 |
| **AWS Lambda** | 100 萬 requests/月 | 企業級整合 |

---

## 5. 安全疑慮：MCP 的陰暗面

### 嚴重程度

2026 年初爆發的安全問題不容忽視：

- **82%** 的 MCP server 有路徑遍歷漏洞
- **38-41%** 缺乏認證機制
- **60 天內揭露 30 個 CVE**
- 最嚴重的 CVE-2025-6514（mcp-remote，CVSS 9.6）影響了 43.7 萬次下載
- **NSA 發布 MCP 安全指引**（2026 年 5 月）

### 五大攻擊模式

| 攻擊類型 | 說明 | 風險等級 |
|---------|------|---------|
| **工具投毒** (Tool Poisoning) | 惡意 server 提供有毒的工具描述，改變 AI 對工具的理解 | 🔴 極高 |
| **提示注入** (Prompt Injection) | 透過外部資料注入惡意指令 | 🔴 極高 |
| **信任繞過** (Trust Bypass) | 利用 AI 隱性信任所有 context window 內容 | 🟡 高 |
| **供應鏈攻擊** | 透過熱門 server 的依賴套件植入惡意程式 | 🟡 高 |
| **跨租戶暴露** | 多用戶共用 server 時的資料洩漏 | 🟠 中高 |

### 核心設計缺陷

> 「MCP 沒有內建身份驗證、沒有最小權限執行、沒有稽核追蹤。安全顯然是事後才想到的。」— SC Media 2026 身份安全分析

2026 Roadmap 正在補這些洞：OAuth 2.1、Gateway 行為規範、Audit Trails。但目前使用者需要自己注意安全。

### 給聽眾的安全建議

1. **只用官方 Registry 或 GitHub 星數高的 server**
2. **閱讀工具描述**，確認 server 只請求必要的權限
3. **敏感資料不要透過不認識的 MCP server 傳遞**
4. **企業用戶**：等 OAuth 2.1 + Audit Trail 功能穩定再大規模部署

---

## 6. 非開發者也能用的 MCP

### 行銷人的 MCP 工具

MCP 最大的突破是**降低了「讓 AI 連接工具」的門檻**。以前需要寫 API 串接程式，現在一個 URL 就能讓 AI 存取你的工具。

| 工具 | 用途 | 對行銷人的價值 |
|------|------|-------------|
| **HubSpot MCP** | CRM 操作 | 讓 AI 直接查客戶資料、分析銷售漏斗 |
| **Google Analytics MCP** | 網站分析 | 「上個月哪些頁面流量掉了？」直接問 AI |
| **Ahrefs MCP** | SEO 分析 | AI 直接拉關鍵字排名、競爭者分析 |
| **Notion MCP** | 內容管理 | AI 直接更新 content calendar |
| **Slack MCP** | 團隊溝通 | AI 匯整頻道重點、追蹤討論 |
| **WordPress MCP** | 網站管理 | 2026/02 推出官方 MCP Adapter |

### 設計師的 MCP 工具

| 工具 | 用途 |
|------|------|
| **Figma MCP** | Design-to-code 流程，遠端 MCP server |
| **Canva MCP** | AI 直接操作 Canva 設計 |

### PM / 營運的 MCP 工具

| 工具 | 用途 |
|------|------|
| **Jira MCP** | 專案管理自動化 |
| **Linear MCP** | Issue tracking |
| **Zendesk MCP** | 客服工單分析 |
| **Intercom MCP** | 對話管理 |

**核心轉變**：產品經理、營運主管、客服團隊現在可以自己打造 AI 自動化，不需要等工程 sprint。這加速了執行、減少了 backlog、讓開發者專注高影響力工作。

---

## 7. 我們自己的 MCP 實戰經驗：podcast-mcp

### 我們怎麼用 MCP

AI 懶人報已經在用 MCP——我們的 Hermes Agent（AI 營運助手）透過自建的 `podcast-mcp` server 操控整個 Podcast 自動化系統。

```
Hermes Agent ←→ podcast-mcp (stdio MCP) ←→ Next.js Dashboard API
```

### 我們的 MCP Server 包含約 40 個工具

| 工具群組 | 數量 | 功能 |
|---------|------|------|
| Pipeline | 5 | 啟動/監控/重試 pipeline |
| Episodes | 12 | 列表/審核/approve/reject/regenerate |
| Scheduler | 5 | 排程管理 |
| Analytics | 4 | 成本/品質/平台數據 |
| YouTube | 3 | 搜尋來源管理 |
| Media | 3 | 縮圖操作 |
| Settings | 2 | 系統設定 |
| n8n | 3 | 觸發 Threads 策展 workflow |
| Git | 5 | 建 branch、查 diff |
| Tasks | ~3 | Task Board 操作 |

### 使用心得

**好處**：
- Hermes Agent 透過 Telegram 就能遠端操控整個系統
- 一個 MCP server 取代了原本需要分散在各處的 webhook/API 呼叫
- 工具定義（schema + description）讓 AI 理解如何使用每個功能

**挑戰**：
- stdio 模式只支援單一使用者
- 工具太多時，AI 有時會選錯工具
- 需要仔細設計工具描述（description），這直接影響 AI 的使用準確度

---

## 8. 產業數據與趨勢

### 採用數據

| 指標 | 數值 | 來源 |
|------|------|------|
| 月 SDK 下載量 | 9,700 萬 | 2026/03，Python + TypeScript |
| 公開 MCP server 數 | 10,000+ | Anthropic 2025/12 更新 |
| Registry 紀錄數 | 9,652（latest）/ 28,959（all versions） | 2026/05/24 |
| GitHub repo 數 | 15,926 | 2026/05/24，mcp-server topic |
| 企業生產部署率 | 41% | Stacklok 2026 軟體報告 |
| 全球月搜尋量 | 622,000+ | Top 50 servers 合計 |
| 美國月搜尋量 | 170,000+ | Top 50 servers 合計 |

### 18 個月增長：970 倍

從 2024 年 11 月的約 200 萬月下載到 2026 年 3 月的 9,700 萬月下載，MCP 在 18 個月內實現了 **970 倍**的增長。

### 四大趨勢

1. **從本地到遠端**：Remote HTTP 部署增長 4 倍，降低使用門檻
2. **從開發者到所有人**：行銷、設計、PM 工具快速增加
3. **從單一公司到產業標準**：Linux Foundation AAIF 治理
4. **安全意識覺醒**：NSA 發布指引、30 CVE 在 60 天內揭露、2026 Roadmap 補強安全

---

## 9. 對聽眾的影響與建議

### 對開發者聽眾

- **現在就開始用 MCP**：它已經是事實標準，不是實驗品
- **推薦入門組合**：Context7 + Brave Search + GitHub + Filesystem + Playwright
- **建自己的 MCP server**：用 FastMCP 框架，Python 幾行就能包裝現有 API
- **關注安全**：定期更新、只用可信來源的 server

### 對非開發者聽眾

- **Remote MCP 是你的入口**：不用裝 Node.js，一個 URL 就能讓 AI 連你的工具
- **先從一個工具開始**：推薦 Notion MCP 或 Slack MCP，搭配 Claude Desktop
- **不要害怕**：MCP 的設計目標就是讓非技術人員也能用 AI 操作工具
- **但要注意安全**：不要在不信任的 MCP server 上傳敏感資料

### 對 Podcast 產業

- **MCP 讓 AI 助手真正「有手有腳」**：不再只是對話，而是能實際操作工具
- **我們自己就是案例**：podcast-mcp 讓 AI 助手透過 Telegram 操控整個 Podcast 產製流程
- **未來可能出現的 Podcast MCP**：Spotify for Podcasters API、SoundOn API 如果推出 MCP server，Podcaster 就能讓 AI 直接管理節目

---

## 10. Episode 腳本建議

### 建議選題：「MCP 爆發！AI 的 USB-C 標準讓所有工具串在一起」

### 腳本結構建議

**開場 Hook（30 秒）**
> 「想像一下，你跟 AI 說『幫我查上個月的銷售數據，做成一張圖表，發到 Slack 給團隊看』——然後 AI 真的做到了。不是因為它變聰明了，而是因為有個叫 MCP 的東西，把 AI 跟你的所有工具串在一起了。」

**段落 1：MCP 是什麼（2 分鐘）**
- USB-C 比喻
- 從 Anthropic 私有 → 產業標準的 18 個月故事
- 970 倍增長的震撼數據

**段落 2：誰在贏（3 分鐘）**
- Top 10 MCP servers 介紹（重點 3-5 個）
- 各大平台支援比較
- 企業 41% 已在生產環境使用

**段落 3：非開發者怎麼用（3 分鐘）**
- 行銷人：HubSpot + Google Analytics MCP
- 設計師：Figma + Canva MCP
- 所有人：Notion + Slack MCP
- Remote HTTP 降低門檻

**段落 4：安全警告（2 分鐘）**
- 60 天 30 個 CVE
- NSA 都出手了
- 實際建議：只用可信來源、不傳敏感資料

**段落 5：我們自己的經驗（2 分鐘）**
- podcast-mcp 的 40 個工具
- Hermes Agent 遠端操控案例
- 自建 MCP server 的心得

**結尾（30 秒）**
- MCP 是 2026 年 AI 最重要的基礎設施變化
- 給聽眾的行動建議

### 預估長度
約 13-15 分鐘，適合單集或搭配其他 AI 新聞作為主題段落。

---

## 研究來源

- [MCP Adoption Statistics 2026](https://www.digitalapplied.com/blog/mcp-adoption-statistics-2026-model-context-protocol) — Digital Applied
- [MCP 97M Downloads](https://www.digitalapplied.com/blog/mcp-97-million-downloads-model-context-protocol-mainstream) — Digital Applied
- [2026 MCP Roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/) — MCP 官方 Blog
- [MCP Ecosystem Growth](https://effloow.com/articles/mcp-ecosystem-growth-100-million-installs-2026) — Effloow
- [Enterprise MCP Adoption](https://www.cdata.com/blog/2026-year-enterprise-ready-mcp-adoption) — CData
- [Anthropic 捐贈 MCP](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation) — Anthropic
- [Linux Foundation AAIF](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation) — Linux Foundation
- [Top 10 Most Popular MCP Servers](https://fastmcp.me/blog/top-10-most-popular-mcp-servers) — FastMCP
- [50 Most Popular MCP Servers](https://mcpmanager.ai/blog/most-popular-mcp-servers/) — MCP Manager
- [Best MCP Clients 2026](https://nimbalyst.com/blog/best-mcp-clients-2026/) — Nimbalyst
- [MCP Security Vulnerabilities](https://aembit.io/blog/the-ultimate-guide-to-mcp-security-vulnerabilities/) — Aembit
- [30 CVEs in 60 Days](https://agent-wars.com/news/2026-03-13-mcp-security-2026-30-cves-in-60-days-what-went-wrong) — Agent Wars
- [NSA MCP Security Guide](https://www.nsa.gov/Portals/75/documents/Cybersecurity/CSI_MCP_SECURITY.pdf) — NSA
- [MCP for Marketing Teams](https://mcpmanager.ai/blog/mcp-for-marketing-teams/) — MCP Manager
- [Best MCP Servers for Marketers](https://segmentstream.com/blog/articles/best-mcp-servers-for-marketers) — SegmentStream
- [MCP Non-Developer Use Cases](https://www.octoparse.com/blog/best-mcp-servers) — Octoparse
- [Cloudflare MCP Servers](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/) — Cloudflare Blog
- [Vercel MCP Deployment](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel) — Vercel Docs
- [GitHub MCP + Linux Foundation](https://github.blog/open-source/maintainers/mcp-joins-the-linux-foundation-what-this-means-for-developers-building-the-next-era-of-ai-tools-and-agents/) — GitHub Blog
- [MCP Wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol) — Wikipedia
- [Thoughtworks MCP Impact](https://www.thoughtworks.com/en-us/insights/blog/generative-ai/model-context-protocol-mcp-impact-2025) — Thoughtworks
