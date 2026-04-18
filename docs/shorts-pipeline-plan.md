# Podcast 短影音 Highlight 自動化 — 技術評估與實作規劃

## Context

替 podcast 每集自動產出 **40–60 秒的短影音 highlight**（for IG Reels / YouTube Shorts / TikTok），用來當「預告 / 精華導流」。

**偏好 & 素材：**
- 畫面主角：頻道的**樹懶吉祥物**形象（非真人），需要能 lip-sync 說話
- 聲音：**VoAI 絕好聲創 API**（台灣口音 TTS，與頻道品牌一致）
- 畫面構成：要有 **吸睛 hook 開場 + 精華重點 + Outro CTA**，可加 B-roll
- 素材：podcast 原始音檔 + IG 封面圖（Google Drive 已有）
- 目標：**自動化** pipeline，品質優先於速度或流程整合

**目前 codebase 已有的基礎（可直接重用）：**
- `src/services/openRouterService.js` — Gemini / Claude 已接好（可做 highlight 判讀）
- `src/services/googleDrive.js` — 音檔 / 圖檔下載
- `src/services/videoCreator.js` — FFmpeg 已接好（但目前只做「靜態圖 + 全集音訊」長片）
- `src/services/kieAi.js` — Kie.ai 圖像生成
- `src/utils/flowHelpers.js` — 共用工具（音訊轉檔、壓縮等）
- `web-console/` — Express + 前端 UI，可加新頁籤觸發短影音 pipeline

**目前沒有的（需新增）：**
- 音訊轉錄（Whisper，需 word-level timestamps）
- Highlight 自動定位（LLM 分析 transcript 找精華）
- VoAI API 客戶端
- 角色動畫 lip-sync API 客戶端（Hedra Character-3）
- B-roll 素材搜尋（Pexels）
- 短影音合成引擎（Remotion）

---

## 技術評估：幾種做法的比較

### 方案 A：純 SaaS（Opus Clip / Vizard API）
- **做法：** 直接把整集音訊丟給 Opus Clip API，它會自動切 viral 短影音（含字幕、重點高亮、裁切 9:16）
- 優點：幾乎零開發、最快上線、已有「virality score」挑選算法
- 缺點：**無法放樹懶吉祥物 avatar、無法指定 VoAI 聲音**，品牌一致性差；不符合「樹懶形象 + VoAI」的需求
- **結論：不採用**

### 方案 B：Opus Clip + 後製加 avatar（Hybrid）
- 優點：Opus Clip 負責找 highlight，我們只做 avatar/VoAI 開場結尾
- 缺點：兩套系統串接麻煩、Opus Clip 對中文 podcast 的 highlight 品質不穩、風格拼接感重
- **結論：不推薦**

### 方案 C：完全自建 pipeline（**已採用**）
- Whisper 轉錄 → LLM 找 highlight → VoAI 配音 → Hedra 動畫樹懶 → Pexels B-roll → Remotion 合成
- 優點：完全客製、品牌一致（樹懶 + VoAI 台灣腔）；每環節可替換、可獨立測試；與現有 Node.js 生態相容；單集成本低
- 缺點：開發工程量較大、需管理多個 API key

---

## 關鍵工具選型

| 環節 | 選擇 | 理由 |
|---|---|---|
| 轉錄 | **OpenAI Whisper API**（`whisper-1` 或 `gpt-4o-transcribe`） | 中文準確度高、word-level timestamps、$0.006/min |
| Highlight 分析 | **既有 `openRouterService`（Gemini 2.5 Flash）** | 已在 codebase、長 context、中文強、低成本 |
| TTS 配音 | **VoAI API** | 台灣口音、品牌一致 |
| 角色動畫 lip-sync | **Hedra Character-3** ⭐ | 比 HeyGen 更適合卡通/風格化角色；HeyGen 為真人 avatar 設計，動畫化樹懶效果差；Hedra 在獨立測試 9/10、中文 15+ 語言、可直接上傳樹懶圖 + 音檔 → 會說話的樹懶 |
| B-roll 素材 | **Pexels Video API**（免費） | 免費、品質夠、API 簡單；關鍵字由 LLM 從 transcript 抽出 |
| 字幕動畫 | **Whisper word-level timestamps → Remotion** | word 級時序能做逐字高亮 |
| 合成引擎 | **Remotion**（React 程式化影片） | 與 Node.js/React 生態契合；可 layer B-roll 背景 + 樹懶 PiP + 動畫字幕；headless Chrome render；自架免費 |
| 輸出上架 | YouTube Shorts（沿用既有 YouTube API）；IG / TikTok 先手動 | 第一階段聚焦產出，上架自動化後期再做 |

> **為什麼不是 HeyGen？** HeyGen Avatar IV 強，但核心是「真人 avatar」，動畫化卡通樹懶效果差且成本高。Hedra Character-3 就是為「靜態角色圖 → 會說話」設計的。日後若要加你本人真人分身，再加 HeyGen 為第二個 avatar 選項。

---

## Pipeline 架構（9 階段）

```
[audio.mp3 + 樹懶圖 + metadata]
        │
   ┌────▼─────┐
   │ 1. Ingest │  ← 重用 googleDrive.js 或 web-console 上傳
   └────┬─────┘
   ┌────▼─────────────┐
   │ 2. Whisper 轉錄   │  → transcript + word timestamps
   └────┬─────────────┘
   ┌────▼───────────────────────┐
   │ 3. LLM Highlight 分析       │  → JSON:
   │    (Gemini via openRouter) │     { hook_script, clips[{start,end,reason}],
   └────┬───────────────────────┘       outro_script, broll_keywords[] }
        │
        ├─────────────────────────────┐
        │                             │
   ┌────▼──────────┐          ┌───────▼────────┐
   │ 4a. VoAI TTS   │          │ 4b. 原音切段    │
   │   hook + outro │          │   FFmpeg -ss   │
   └────┬──────────┘          └───────┬────────┘
   ┌────▼──────────────────┐          │
   │ 5. Hedra Character-3   │          │
   │   樹懶圖 + VoAI 音檔   │          │
   │   → 會說話的樹懶 MP4   │          │
   └────┬──────────────────┘          │
        │                             │
   ┌────▼──────────┐                  │
   │ 6. Pexels API  │                  │
   │   B-roll 搜尋  │                  │
   └────┬──────────┘                  │
        │                             │
   ┌────▼─────────────────────────────▼────┐
   │ 7. Caption Generator                    │
   │    word timestamps → Remotion props     │
   └────┬────────────────────────────────────┘
   ┌────▼─────────────────────────────────────┐
   │ 8. Remotion Compose (9:16, 1080×1920)    │
   │    layers:                                │
   │      bg:      B-roll (blurred / ken burns)│
   │      center:  原音波形 or 樹懶全身        │
   │      corner:  會說話樹懶 (hook/outro 時)  │
   │      bottom:  動態逐字字幕                │
   │      audio:   hook(VoAI) → 原音 → outro   │
   └────┬─────────────────────────────────────┘
   ┌────▼──────────────┐
   │ 9. 輸出 / 上架     │  → MP4 存本地 + 可選自動傳 Shorts
   └───────────────────┘
```

**短影音結構模板（40–60 秒）：**
- `0–8s` **Hook**：樹懶 avatar 說 VoAI 產生的吸睛開場（由 LLM 從本集重點寫出一句 hook）
- `8–50s` **精華**：從原音切出 LLM 判定最精彩的段落（可切 1–2 段，加字幕、加 B-roll 背景）
- `50–60s` **Outro**：樹懶 avatar 說 CTA（訂閱 / 完整集數連結）

---

## 檔案結構（新模組，不動現有 flow）

```
src/services/shortsPipeline/
├── index.js              # orchestration（串起所有 stage）
├── transcribe.js         # Whisper API wrapper
├── highlightExtractor.js # 呼叫 openRouterService，prompt 在這
├── voai.js               # VoAI API client
├── hedra.js              # Hedra Character-3 API client
├── pexels.js             # B-roll 搜尋
├── audioCutter.js        # FFmpeg 切音段（可重用 flowHelpers 邏輯）
└── README.md

remotion/                 # 獨立 Remotion 子專案（React）
├── src/
│   ├── Root.tsx
│   ├── ShortVideo.tsx    # 主 composition
│   ├── components/
│   │   ├── AnimatedCaption.tsx
│   │   ├── SlothAvatar.tsx
│   │   └── BRollLayer.tsx
│   └── index.ts
├── package.json
└── remotion.config.ts

scripts/
└── generate-short.js     # CLI 入口：node scripts/generate-short.js --audio=... --avatar=...

# web-console（Phase 4 才碰）
web-console/public/index.html  # 新增「Shorts Generator」分頁
web-console/server.js          # 新增 POST /api/shorts/generate endpoint
```

**重用現有模組：**
- `src/services/openRouterService.js` — 直接呼叫 `gemini-2.5-flash` 做 highlight 分析
- `src/services/googleDrive.js` — 下載音檔 / 樹懶圖
- `src/utils/flowHelpers.js` 的 `convertAudioToMp3()` — 音訊格式正規化

---

## 環境變數（新增）

```
OPENAI_API_KEY=             # Whisper 轉錄
VOAI_API_KEY=               # VoAI TTS
VOAI_VOICE_ID=              # 選定的台灣聲優 ID
HEDRA_API_KEY=              # Hedra Character-3
PEXELS_API_KEY=             # B-roll 免費
SLOTH_AVATAR_IMAGE_PATH=    # 樹懶形象圖（本地或 Drive file ID）
```

---

## 成本估算（每支短影音約略）

| 項目 | 成本 |
|---|---|
| Whisper（60 分鐘 podcast） | ~$0.36 |
| Gemini 2.5 Flash highlight 分析 | <$0.05 |
| VoAI TTS（約 150 字 hook+outro） | ~$0.30–0.80 |
| Hedra Character-3（約 15 秒 avatar） | ~$0.50–1.50 |
| Pexels | 免費 |
| Remotion render（自架） | 免費 |
| **合計** | **~$1.5 – $3 USD / 集** |

---

## Phased 實作

### Phase 1：Highlight 定位 + 純原音短片
1. 建 `transcribe.js`（Whisper）+ 測 1 集
2. 建 `highlightExtractor.js` + prompt，輸出 JSON
3. 建 `audioCutter.js` 切音段
4. 建 Remotion 專案、最簡 composition：原音 + 靜態樹懶 + 動態字幕
5. CLI `scripts/generate-short.js` 串起來，輸出 9:16 MP4
6. **里程碑：能跑出「字幕 + 樹懶靜圖 + 40–60 秒」的 MP4**

### Phase 2：VoAI + Hedra 會說話樹懶
1. 建 `voai.js` 生成 hook + outro 音檔
2. 建 `hedra.js`：樹懶圖 + VoAI 音檔 → 動畫 MP4（含 poll 任務狀態）
3. Remotion 新增 `SlothAvatar.tsx`，hook/outro 時段疊上動畫樹懶
4. 音訊混音：hook(VoAI) → 原音 → outro(VoAI)
5. **里程碑：會說話的樹懶開場 + 精華 + 收尾**

### Phase 3：B-roll 背景
1. 建 `pexels.js`，依 `broll_keywords` 搜尋 stock 影片
2. Remotion 新增 `BRollLayer.tsx`，背景 B-roll（模糊 / Ken Burns）
3. **里程碑：電影感 B-roll + 樹懶主體**

### Phase 4：整合進 web-console
1. `web-console` 新增「Shorts Generator」分頁
2. 進度條、log 串流
3. （可選）產出後自動上傳 YouTube Shorts

---

## Critical Files

### 需要**新增**
- `src/services/shortsPipeline/*`
- `remotion/*`
- `scripts/generate-short.js`
- `.env` 新變數

### 需要**讀懂 / 參考**
- `src/services/openRouterService.js` — LLM 呼叫範例
- `src/services/googleDrive.js` — 下載
- `src/utils/flowHelpers.js:382` `APPENDED_TEXT` / `APPENDED_TEXT2` — CTA 文案可複用到 outro 腳本
- `src/services/videoCreator.js` — 現有 FFmpeg 風格參考

### Phase 4 才修改
- `web-console/server.js` — 加 `/api/shorts/*` 路由
- `web-console/public/index.html` — 新分頁 UI
- `package.json` — 新增 deps：`openai`、`remotion`、`@remotion/cli`、`axios`

---

## 驗證計畫（E2E）

1. **Unit 層級：** 每個 stage 獨立跑，單獨驗證輸出
2. **Pipeline 整合：** 5 分鐘測試 podcast 跑完整 pipeline
3. **品質檢查：** Hook 是否抓到本集最有梗的一句、樹懶 lip-sync 自然度、字幕時序、9:16 格式、音量平衡
4. **A/B 比較：** 同一集手動 vs pipeline，比品質
5. **成本追蹤：** 第一集記錄每階段 API 花費

---

## 待提供 / 確認

- [ ] VoAI 聲優 ID（到 voai.ai 試聽選 1–2 個）
- [ ] 樹懶形象圖：clean front-facing PNG
- [ ] OpenAI API Key（Whisper）
- [ ] VoAI API Key
- [ ] Hedra API Key（hedra.com 註冊）
- [ ] Pexels API Key（免費）
- [ ] Remotion render：本地 or Lambda 雲端

---

## 參考連結

- [Hedra Character-3](https://www.hedra.com/) — 角色動畫首選
- [HeyGen API](https://www.heygen.com/enterprise-api) — 日後若加真人 avatar
- [VoAI 絕好聲創](https://www.voai.ai/)
- [Remotion](https://www.remotion.dev/)
- [Pexels Video API](https://www.pexels.com/api/documentation/)
- [OpenAI Whisper API](https://platform.openai.com/docs/guides/speech-to-text)
- [Opus Clip](https://www.opus.pro/) — 比較基準
