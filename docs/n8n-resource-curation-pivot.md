# N8N 內容策展流程：轉向「實用資源」改動說明

## 背景

原本的 n8n 流程每天爬 YouTube / Reddit / GitHub / Twitter 的 AI 新聞與趨勢，AI 評分後生成 Threads 貼文草稿、寄 Email 審核。

**新方向**：專門爬觀眾（正在用 Claude Code / Codex / AI coding agent 的開發者與獨立創作者）會有興趣的主題——
- 免費學習資源
- 超好用的 GitHub repo
- 能跟 Claude Code / Codex 一起搭配使用的工具

**策略**：資源流為主、時事為輔。流程骨架（搜尋 → 過濾 → AI 評分 → 生文 → Email 審核）不變，只調整 **來源 query、評分標準、去重記憶**，外加修一個既有 bug。

> 生文 prompt、Email 審核、Reddit / Twitter 來源、整體流程結構**都不動**。

---

## 改動清單（共 5 處 + 1 個選配節點）

在 n8n 裡打開對應節點，把欄位內容整個換掉即可。

### 1. 節點 `YouTube 搜尋設定` — 換 query（新聞 → 資源）

JavaScript 欄位整個換成：

```js
const searches = [
  { query: 'Claude Code tutorial', maxResults: 5 },
  { query: 'MCP server', maxResults: 5 },
  { query: 'AI coding tools', maxResults: 5 },
  { query: 'best free AI course', maxResults: 5 },
  { query: 'Codex CLI', maxResults: 5 },
  { query: 'Cursor AI tips', maxResults: 5 },
  { query: 'open source AI developer tools', maxResults: 5 },
  { query: 'AI agent workflow automation', maxResults: 5 }
];
return searches.map(s => ({ json: s }));
```

---

### 2. 節點 `GitHub 搜尋設定` — 修「永遠回空」+ 換成資源 topic

**重點**：原本 `created:>兩天前 AND stars:>1500` 幾乎永遠回空（兩天內生出 1500 星的 repo 極罕見）。改用 `pushed:>`（近期有更新＝還活著的好工具），星數門檻降到合理值。

JavaScript 欄位整個換成：

```js
const recent = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
const queries = [
  { q: `topic:mcp pushed:>${recent} stars:>100`, sort: 'stars', per_page: 20 },
  { q: `claude code in:name,description,readme stars:>150 pushed:>${recent}`, sort: 'stars', per_page: 20 },
  { q: `topic:ai-agent pushed:>${recent} stars:>300`, sort: 'stars', per_page: 15 },
  { q: `topic:developer-tools pushed:>${recent} stars:>500`, sort: 'stars', per_page: 15 },
  { q: `codex in:name,description stars:>200 pushed:>${recent}`, sort: 'stars', per_page: 15 }
];
return queries.map(q => ({ json: q }));
```

---

### 3. 節點 `GitHub 整理資料` — 修既有 bug

找這一行：

```js
seen(r.full_name);
```

改成：

```js
seen.add(r.full_name);
```

（原本掉了 `.add`，會直接報錯。）

---

### 4. 節點 `AI 內容評分` — 重配評分權重

資源型內容該獎勵「立刻能用」而非「夠炸」。維持總分 100（後面 worthSharing 門檻邏輯不用動）。

**只改 System Message 欄位**，整個換成：

```
你在為「AI 懶人報」篩選值得分享給觀眾的實用資源。觀眾＝正在用 Claude Code / Codex / AI coding agent 的開發者與獨立創作者。請對內容評分，四個維度加總 100：

1. 【實用性／可立即上手】35 分
   - 28-35：能直接接進 workflow（MCP、CLI、外掛）、附安裝/用法、省下實際時間。
   - 15-27：明確的 prompt / template / 教學，看完能上手。
   - 1-14：純概念、無落地路徑。

2. 【與 AI coding 工作流的契合度】30 分
   - 24-30：能跟 Claude Code / Codex / Cursor 直接搭配使用的工具或技巧。
   - 12-23：對 AI 開發者有用但非直接整合（學習資源、通用工具）。
   - 1-11：跟這群人的日常無關。

3. 【新穎性／隱藏寶藏】20 分
   - 16-20：少人知道的 hidden gem、剛冒出的好工具。
   - 8-15：已知工具的殺手級更新。
   - 1-7：老生常談。

4. 【收藏／話題價值】15 分
   - 12-15：清單型、懶人包、值得收藏。
   - 6-11：有清楚截圖/流程。
   - 1-5：平鋪直敘。

worthSharing：只有「對 Claude Code/Codex 使用者真的有用」才給 true。純新聞、人物八卦、無法上手的 demo 一律 false。
```

> ⚠️ **不要動**這顆節點的 JSON 結構（它連著 model 跟 parser）。原本的 systemMessage 裡有 `{"scores":{...}}` 輸出格式說明——換掉後若輸出格式跑掉，把那段「輸出 JSON 格式」說明補回 System Message 結尾。

---

### 5. 節點 `過濾空值與去重` — 加歷史去重

新聞過期就沒了，但好 repo 會天天冒出來；沒有持久去重會一直重發同一個 awesome-list。

JavaScript 欄位整個換成：

```js
const items = $input.all();

// 讀『已發過的 guid』節點做歷史去重；還沒建該節點時 try/catch 先跳過、不報錯
let sent = new Set();
try {
  const rows = $('已發過的 guid').all() || [];
  sent = new Set(rows.map(r => r.json.guid).filter(Boolean));
} catch (e) {}

const seen = new Set();
const filtered = [];
for (const item of items) {
  if (item.json.empty || !item.json.guid) continue;
  if (sent.has(item.json.guid)) continue;   // 歷史已發過 → 跳過
  if (seen.has(item.json.guid)) continue;    // 本次重複 → 跳過
  seen.add(item.json.guid);
  filtered.push(item);
}

if (filtered.length === 0) {
  return [{ json: { noContent: true, message: '沒有新的（未發過的）資源' } }];
}
return filtered;
```

---

### 6.（選配）真正啟用歷史去重

加一個 **Data Table** 節點：
1. 操作選 **Get row(s)**
2. 表選 `Threads_post_records`（就是 `Insert row` 那張）
3. 命名為 **`已發過的 guid`**（名字要一模一樣，第 5 步靠它抓）
4. 接在 `每天 09:00 執行` 之後

不加也沒關係：第 5 步的 try/catch 會讓它先只做「當次去重」。

---

## 驗證

改完 1～5 後，先用 **Execute Workflow** 手動跑一次，確認：
- GitHub query 有回結果（不是空的）
- AI 評分有挑出工具類內容（worthSharing=true）
- 生文 + Email 審核照常運作

確認沒問題再開排程。

---

## 沒動到的部分（之後可再優化）

- **Reddit / Twitter 來源**：Twitter 那條目前全是人物八卦（Elon / Altman / TSLA），跟資源流牴觸。本次選「時事為輔」先留著當配菜；想純化的話，直接停用該分支即可。
- **生文 prompt**：仍是「頂級流量操盤手」語氣。資源型其實更適合「懶人包 / 工具清單」口吻，未來可改。
- **執行位置**：目前生文 / 審核都在 n8n。Dashboard 已有 voice writer + 爆文評分 + Telegram 審核，未來可考慮 n8n 只負責爬料、把 Top N 丟進 dashboard 生文，語氣更一致。
