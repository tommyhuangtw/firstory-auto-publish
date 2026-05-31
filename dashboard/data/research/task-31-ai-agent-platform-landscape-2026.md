# 2026 年 5 月 AI Agent 平台橫向掃描：從 OpenAI Operator 到 Claude Computer Use，誰真的能用？

## 研究目的
系統性掃描目前市面上已可使用的 AI Agent 平台與工具，整理成結構化比較表，涵蓋功能範圍、定價、實際可用性與適合對象。本研究旨在解鎖 Board 上 3 個 Agent 相關提案的決策基礎，並提供 episode 切入角度。

---

## 一、什麼是 AI Agent？2026 年的定義

2026 年的 AI Agent 已從「自動補完程式碼」進化到「自主完成多步驟任務」。核心特徵：

1. **自主規劃**：接收高階目標後，自行拆解步驟
2. **工具使用**：呼叫 API、操控瀏覽器、執行程式碼
3. **迭代修正**：遇到錯誤能自行 debug 和重試
4. **持久記憶**：跨 session 保留上下文

市場已形成四大類別：
- **瀏覽器自動化 Agent**（Operator、Manus）
- **程式碼 Agent**（Claude Code、Codex、Devin、Cursor）
- **企業工作流 Agent**（Copilot Studio、CrewAI、Relevance AI）
- **開發框架**（LangGraph、Microsoft Agent Framework、CrewAI OSS）

---

## 二、平台比較總表

### A. 消費級 / 瀏覽器自動化 Agent

| 平台 | 開發商 | 定價 | 實際可用性 | 適合誰 |
|------|--------|------|-----------|--------|
| **OpenAI Operator** | OpenAI | ChatGPT Pro $200/月（即時存取）；Plus $20/月（候補+限量） | ⚠️ 僅美國；無 API；速度慢、易出錯 | 願付高價的早期採用者；瀏覽器自動化探索 |
| **Manus AI** | Manus（Meta 收購後） | 免費 300 點/天；Standard $20/月；Extended $200/月 | ✅ 全球可用；Web App Builder、桌面端、Slack/Telegram 整合 | 通用研究型任務；非技術使用者 |
| **Google Project Mariner** | Google | — | ❌ 已於 2026/5/4 關閉；技術併入 Gemini Agent | — |
| **Lindy AI** | Lindy | 免費 400 點/月；Pro $49.99/月；Business $299/月 | ✅ 穩定可用；4,000+ app 整合；語音 Agent | 營運自動化；客服；非技術團隊 |

### B. 程式碼 Agent

| 平台 | 開發商 | 定價 | 實際可用性 | 適合誰 |
|------|--------|------|-----------|--------|
| **Claude Code** | Anthropic | Pro $20/月；Max 5x $100/月；Max 20x $200/月；6/15 起獨立 credit pool | ✅ 生產就緒；終端機 CLI + IDE；MCP 生態系；subagent 架構 | 中高階開發者；需要 agent 級自主性的專案 |
| **OpenAI Codex** | OpenAI | Plus $20/月；Pro $200/月；Business $20-25/user/月；token-based billing | ✅ 雲端 Agent 環境；parallel tasks；SWE-Bench Pro #1（56.8%） | 企業團隊；需要雲端沙盒和 CI/CD 整合的場景 |
| **Devin 2.0** | Cognition Labs | Core $20/月 + $2.25/ACU（≈15 分鐘工作）；Team $500/月含 250 ACU | ⚠️ 適合明確規格的重複任務；開放式任務表現不穩定 | 5+ 人工程團隊；有大量 migration/refactoring tickets |
| **Cursor** | Anysphere | Free tier；Pro $20/月；Business $40/月；估值 $293 億 | ✅ IDE 內建 Agent Mode；廣泛採用 | 偏好 IDE 整合的開發者 |
| **GitHub Copilot** | GitHub/Microsoft | Free tier；Pro $10/月；Business $19/月 | ✅ 最大用戶基礎（470 萬付費用戶）；Agent Mode + Workspace Agents | 已在 GitHub 生態系的團隊 |

### C. 企業工作流 Agent

| 平台 | 開發商 | 定價 | 實際可用性 | 適合誰 |
|------|--------|------|-----------|--------|
| **Microsoft Copilot Studio** | Microsoft | M365 Copilot $30/user/月 起；Copilot Studio 獨立方案另計 | ✅ GA；Computer-Using Agents 已正式發布；深度 Office 整合 | 已用 Microsoft 365 的企業 |
| **CrewAI** | CrewAI | Free 50 次/月；Pro $25/月；Enterprise ~$60-120K/年 | ✅ Fortune 500 的 63% 使用；2B+ 次 agent 執行 | 需要多 agent 協作的企業；Python 開發者 |
| **Relevance AI** | Relevance AI | Free 200 Actions/月；Pro $19/月；Team $234/月 | ✅ Low-code；9,000+ 整合；400+ 模板 | 銷售/行銷/客服團隊；非技術營運人員 |

### D. 開發框架（Build Your Own Agent）

| 框架 | 維護者 | 定價 | 狀態 | 適合誰 |
|------|--------|------|------|--------|
| **LangGraph** | LangChain | MIT 開源免費；Platform Plus $0.005/次 | ✅ 推薦框架；durable execution；human-in-the-loop | 需要完全控制 agent 行為的開發團隊 |
| **Microsoft Agent Framework (MAF)** | Microsoft | 開源免費（.NET + Python） | ✅ 1.0 GA（2026/4）；統一 AutoGen + Semantic Kernel | .NET/Python 企業開發者 |
| **AutoGen** | Microsoft (社群) | 開源免費 | ⚠️ 維護模式；不再新增功能；建議遷移至 MAF | 研究/原型用途 |
| **CrewAI OSS** | CrewAI | 開源免費 | ✅ 活躍開發 | Python 開發者；多 agent 場景 |

---

## 三、關鍵協定：MCP 與 A2A

2026 年 Agent 生態的兩大標準協定：

### MCP（Model Context Protocol）
- **Anthropic 主導**，2024/11 發布，已移交 Linux Foundation
- **用途**：讓 AI 模型連接外部工具和資料來源（「AI 的 USB-C」）
- **生態規模**：97M 月下載（2026/3）、970x 成長
- **支援平台**：Claude Code、Cursor、Windsurf、VS Code、Copilot 等主流工具
- **安全疑慮**：60 天內出現 30 個 CVE，協定設計有根本性授權缺口

### A2A（Agent-to-Agent Protocol）
- **Google 主導**，2025/4 發布，現由 Linux Foundation 管理
- **用途**：讓不同廠商的 Agent 互相發現、委派任務、協作
- **採用**：150+ 組織；Microsoft、AWS、Salesforce、SAP 已部署
- **與 MCP 互補**：MCP 連接 Agent ↔ 工具；A2A 連接 Agent ↔ Agent

---

## 四、實際可用性評估矩陣

| 維度 | OpenAI Operator | Manus AI | Claude Code | Codex | Devin 2.0 | Copilot Studio | CrewAI | Relevance AI | Lindy AI |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 全球可用 | ❌ 僅美國 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 免費試用 | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| API 存取 | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 非技術可用 | ✅ | ✅ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ✅ | ✅ |
| 成本可預測 | ✅ 月費制 | ⚠️ 點數制 | ⚠️ token 用量 | ⚠️ token 用量 | ❌ ACU 不透明 | ⚠️ 隨用量 | ❌ LLM 成本遠高於授權費 | ⚠️ 點數制 | ⚠️ 點數制 |
| 企業就緒 | ❌ | ❌ | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |

---

## 五、「誰真的能用」— 場景推薦

### 場景 1：個人開發者想提升效率
**首選**：Claude Code（$20/月）或 GitHub Copilot（$10/月）
- Claude Code 的 agentic 能力最強——可以自主讀 code、跑測試、開 PR
- Copilot 勝在整合度和價格，但 agent 模式仍在追趕
- Cursor 如果你偏好 IDE 內操作

### 場景 2：工程團隊（5-20 人）想自動消化 ticket backlog
**首選**：Devin 2.0（$500/月 Team plan）+ Claude Code
- Devin 適合「規格明確」的 migration/refactoring 任務，可平行開多個 instance
- Claude Code 適合「需要思考」的複雜任務
- 企業報告稱 Devin 帶來 12x 效率提升（限特定場景）

### 場景 3：非技術團隊想自動化營運流程
**首選**：Lindy AI 或 Relevance AI
- Lindy：4,000+ app 整合、語音 Agent、客服/會議/email 自動化
- Relevance AI：銷售/行銷導向、9,000+ 整合、multi-agent 協作
- 兩者都是 low-code/no-code，不需要寫程式

### 場景 4：企業想在既有 Microsoft 生態導入 Agent
**首選**：Microsoft Copilot Studio + MAF
- Computer-Using Agents 已 GA
- 深度整合 Word/Excel/PowerPoint/Teams
- 開發者可用 MAF（.NET/Python）建自訂 agent

### 場景 5：開發團隊想自建 Agent 系統
**首選**：LangGraph（MIT 開源）
- 我們專案已在用 LangGraph（content pipeline）
- Durable execution、human-in-the-loop、streaming 支援完整
- 配合 MCP 可連接任何外部工具

### 場景 6：通用研究與資料整理
**首選**：Manus AI（免費 300 點/天）
- 自主瀏覽網頁、執行程式碼、產出報告
- 但品質不穩定，適合初步探索而非最終產出

---

## 六、2026 年 AI Agent 生態的五大趨勢

### 1. 定價大戰：從訂閱制走向用量制
幾乎所有平台都在 2026 Q1-Q2 轉向 token/credit/ACU 計費。好處是降低入門門檻（Devin 從 $500 降到 $20），壞處是成本難以預測。CrewAI 企業客戶報告 LLM API 成本（$180-360K/年）遠超平台授權費（$60-120K/年）。

### 2. 「截圖式」瀏覽器 Agent 逐漸退場
Google Project Mariner 的關閉是標誌性事件——靠截圖+視覺理解操控瀏覽器太慢、太貴、太容易出錯。市場正往 **API 優先 + 視覺備用** 模式演化（如 Copilot Studio 的 Computer-Using Agents 僅在無 API 時才用視覺）。

### 3. Agent 互通標準成形
MCP（工具連接）+ A2A（Agent 協作）兩大協定已被 Linux Foundation 接管，150+ 組織參與 A2A。這意味著未來 Agent 不必綁定單一平台——你的 Claude Code agent 可以呼叫 Salesforce 的 agent 完成 CRM 更新。

### 4. 程式碼 Agent 最成熟，通用 Agent 仍在探索
程式碼 Agent（Claude Code、Codex、Devin）已有明確的 ROI 數據和生產案例。通用 Agent（Operator、Manus）仍然更像「demo」而非「工具」。

### 5. 安全與治理成為必要議題
MCP 60 天 30 個 CVE、Agent 可自主操作系統的風險，讓企業開始要求 SOC2/HIPAA 合規、audit log、RBAC。CrewAI 和 Copilot Studio 在這方面最成熟。

---

## 七、對 AI 懶人報的影響與建議

### 自身系統升級建議
1. **MCP 生態加深**：我們的 Hermes Agent 已用 MCP，可考慮讓更多系統組件走 MCP 標準化
2. **A2A 觀望**：目前規模不需要 Agent-to-Agent 協作，但值得追蹤
3. **Auto Task Executor 優化**：目前用 Claude Code CLI，已是最成熟的 code agent 方案

### 3 個 needs_tommy 提案的決策建議

**提案 A：Agent 實測**
- 建議選 **Manus AI**（免費可用、通用任務）+ **Devin 2.0**（code agent、有料可講）做實測對比
- 聽眾最有感的是「花 $20 到底能不能幫我寫 code」這種實際問題

**提案 B：Agent 落地案例**
- 主打我們自己的 **Auto Task Executor** 作為落地案例（用 Claude Code agent 自動執行 Task Board）
- 搭配 **CrewAI enterprise 數據**（Fortune 500 的 63% 使用）做外部佐證

**提案 C：CLAUDE.md 心法**
- 直接可做——我們有大量自用經驗
- 可對比 Codex 的 AGENTS.md 和其他 agent 配置方式，展示不同 agent 的「指導哲學」差異

### Episode 切入角度建議

| Episode 主題 | 角度 | 目標聽眾 |
|-------------|------|---------|
| 「AI Agent 到底是什麼？2026 年白話版」 | 從 ChatGPT → Agent 的演化，用生活化比喻解釋 | 一般聽眾 |
| 「花 $20 請 AI 工程師：Devin 2.0 vs Claude Code 實測」 | 實際任務對比，成本計算 | 開發者 |
| 「非工程師也能用的 AI Agent：Lindy、Relevance AI 實測」 | 營運自動化場景 demo | 非技術聽眾 |
| 「我們怎麼用 AI Agent 自動產 Podcast——AI 懶人報幕後」 | 自身系統架構分享 | 技術聽眾 |
| 「MCP + A2A：AI 的 USB-C 和 Wi-Fi」| 標準協定白話解說 | 所有聽眾 |

---

## 八、資料來源

1. [OpenAI Operator Specs, Pricing & Performance Guide](https://ucstrategies.com/news/openai-operator-specs-pricing-real-world-performance-guide-2026/)
2. [Claude Code Pricing 2026](https://www.finout.io/blog/claude-code-pricing-2026)
3. [Anthropic Claude API Pricing 2026](https://www.cloudzero.com/blog/anthropic-claude-api-pricing/)
4. [Google Project Mariner Shutdown](https://www.digitaltrends.com/computing/google-pulls-the-plug-on-project-mariner-the-ai-agent-that-browsed-the-web-like-a-human/)
5. [Microsoft Copilot Studio May 2026 Updates](https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/new-and-improved-computer-using-agents-a-new-workflows-experience-and-real-time-voice-experiences/)
6. [Microsoft Agent Framework 1.0](https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/)
7. [CrewAI Pricing & Statistics 2026](https://checkthat.ai/brands/crewai/pricing)
8. [Relevance AI Pricing 2026](https://checkthat.ai/brands/relevance-ai/pricing)
9. [Devin 2.0 Review: Price Drops to $20](https://weavai.app/blog/en/2026/05/13/devin-2-0-review-2026-ai-engineer-price-drops-to-20/)
10. [Manus AI Pricing 2026](https://www.lindy.ai/blog/manus-ai-pricing)
11. [OpenAI Codex Pricing](https://developers.openai.com/codex/pricing)
12. [Lindy AI Review 2026](https://www.nocode.mba/articles/lindy-ai-review)
13. [LangGraph Framework](https://www.langchain.com/langgraph)
14. [A2A Protocol 150+ Organizations](https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year)
15. [AI Agent Frameworks 2026 Ranking](https://alicelabs.ai/en/insights/best-ai-agent-frameworks-2026)
16. [Coding Agents Comparison 2026](https://kingy.ai/ai/codex-vs-claude-code-vs-cursor-vs-windsurf-vs-manus-a-practical-map-of-ai-coding-agents-for-2026/)
