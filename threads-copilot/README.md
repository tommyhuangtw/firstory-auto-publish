# Threads 海巡 Copilot

瀏覽 Threads 時,用**你的興趣偏好**即時 highlight 值得回覆的貼文。

取代之前用分身帳號自動爬蟲（一直被 Meta ban）的做法:改成**你本人登入、手動滑**,extension 只讀你眼前已載入的畫面,在該回覆的貼文旁邊放一個徽章。**只讀、只評分、只顯示——永遠不幫你按讚/回覆/追蹤,也不發任何請求給 Threads。** 出手永遠是你手動。

跟 podcast 後台系統完全獨立,評分服務可以自己跑在 M4 Mac 上。

---

## 架構

```
Threads 頁面(你登入、手動滑)
  └─ content script  抽已載入的貼文 + 去重(shortcode)
        └─ service worker  ──POST──▶  http://127.0.0.1:8770/score
                                         (light Node 服務,自帶 preference.json)
        ◀── reply / watch / skip ────────┘
  └─ 在 on-topic 的貼文旁畫徽章 + 👍/👎
```

- **`service/`** — 評分腦子。獨立 Node 服務(零 npm 依賴),持有你的偏好、算 niche 相關性 + 熱度、學 👍/👎。
- **`extension/`** — MV3 瀏覽器擴充。只負責抽畫面 + 顯示徽章。

偏好 profile 內建 Tommy 的 niche（AI / 接案 / 職涯 / 留學 / 英美生活,移植自 dashboard `trends/scorer.ts`),可在 popup 加自訂關鍵字、用 👍/👎 微調。

---

## 安裝 & 啟動

### 1. 起評分服務（在 M4 Mac 上）

```bash
cd threads-copilot/service
npm start                      # http://127.0.0.1:8770
# 換 port:  THREADS_COPILOT_PORT=9000 npm start
```

驗證: `curl http://127.0.0.1:8770/health` → `{"ok":true}`

> 需要 Node（本專案用 v22）。**沒有任何 npm 依賴**,不用 `npm install`。

### 2. 載入擴充

1. Chrome → `chrome://extensions`
2. 開右上「開發人員模式」
3. 「載入未封裝項目」→ 選 `threads-copilot/extension/`
4. 開 [threads.com](https://www.threads.com)、登入、開始滑

往下滑時:
- 符合你 niche **且互動數 ≥ 門檻**(預設 100)的貼文,上方出現綠色 **💬 值得回覆** 標記 + 左側綠色邊條
- 右上角浮出 **🎯 可回覆** 面板,自動累積這些貼文;點任一項→開啟原文直接回覆。可收合、可清空(🗑)。
- 門檻以下、或不在你興趣範圍的貼文**完全不顯示**(徹底去雜訊)
- 標記上 👥=互動數、🔥=熱度、👍/👎=調整偏好

**面板會保留**:候選存在瀏覽器本地(`chrome.storage.local`),跨開關 Threads / 重開瀏覽器都在——**下次打開 Threads,之前滑到的建議已經在面板裡,不用重滑**。超過 24 小時的自動清掉;點過的顯示已讀灰。這是零額外請求、零 ban 風險的做法(只保留你自己滑過看到的,不主動去抓)。

面板頂端有 **filter**,對已收集的清單即時篩選(選擇會記住):
- **類別** — AI / 接案 / 職涯 / 留學 / 海外生活 / 自訂 / 全部
- **互動數** — ≥50 / ≥100 / ≥200 / ≥500 / 不限
- **時間** — 6h / 12h / 24h 內 / 不限(依你滑到它的時間)

在 popup 可改「顯示門檻(互動數)」(常用 80 / 100)、服務網址、自訂關鍵字。

---

## 你的偏好(personalization)

存在 `service/preference.json`（首次由 `preference.default.json` 種下,gitignored）。

| 欄位 | 說明 | 預設 |
|------|------|------|
| `minEngagement` | **硬門檻**:讚+回覆 低於此數 → 完全不顯示 | 100 |
| `extraKeywords` | 內建 niche 之外的自訂興趣詞(popup 可編輯) | `[]` |
| `mutedAuthors` | 👎 過的作者,永遠不顯示 | `[]` |
| `likedAuthors` | 👍 過的作者,即使低於門檻也顯示 | `[]` |

改法:① popup 的「自訂興趣關鍵字」欄 ② 貼文上的 👍/👎 ③ 直接編 `preference.json`。改完即時生效(下次 /score 重讀)。

---

## Ban 風險(為什麼這比舊爬蟲安全)

Meta 抓的是**伺服器觀測得到的行為**:異常請求量、自動化指紋、新帳號、高頻動作。這個 extension 在頁面**已經送達你真實 session 之後**才讀 DOM,不發任何額外請求、不自動捲動、不出手,伺服器端沒有可偵測的足跡。舊爬蟲被 ban 是因為分身帳號 + 自動化把上述訊號全疊滿了。

**紅線(別跨):** 一旦讓它自動按讚/回覆/追蹤,或主動打 Threads API 補資料,就重新踏進 Meta 的 spam 偵測區。保持只讀。

---

## 已知限制(Phase 1)

- 讚/回覆數讀畫面上的**縮寫**（「1.2K」),精確整數要之後接 GraphQL 攔截才有(Phase 2)。
- feed 是虛擬化的,只評分滑過看到的;MutationObserver 會處理捲動新載入的貼文。
- selector 依賴 Threads 的 `aria-label`（讚/回覆 或 Like/Reply）與結構,Threads 改版可能要調 `extension/src/extract.js`。

## 測試

```bash
cd service && npm test      # scorer + extract 單元測試
```
