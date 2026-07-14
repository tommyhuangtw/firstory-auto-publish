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

on-topic 的貼文上方會出現:
- **💬 可回覆**（綠）— 你的 niche + 有熱度 + 夠新
- **👀 觀察**（橘）— 你的 niche 但還很安靜 / 較舊
- 🔥 分數 = 熱度(engagement velocity),↗ 開啟原文,👍/👎 調整偏好

若服務 port 不是 8770,點擊擴充圖示在 popup 改「服務網址」。

---

## 你的偏好(personalization)

存在 `service/preference.json`（首次由 `preference.default.json` 種下,gitignored）。

| 欄位 | 說明 | 預設 |
|------|------|------|
| `minEngagement` | 讚+回覆 低於此 → 標「觀察」而非「可回覆」 | 30 |
| `recencyHours` | 超過此小時數的貼文 → 降為「觀察」 | 48 |
| `extraKeywords` | 內建 niche 之外的自訂興趣詞(popup 可編輯) | `[]` |
| `mutedAuthors` | 👎 過的作者,永遠 skip | `[]` |
| `likedAuthors` | 👍 過的作者,即使安靜也標「可回覆」 | `[]` |

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
