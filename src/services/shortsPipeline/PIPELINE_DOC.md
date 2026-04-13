# Shorts Pipeline — 完整技術文件

> 自動化 40–60 秒 Podcast 精華短影音產生器
> 輸出：1080x1920 直式 MP4（IG Reels / YouTube Shorts / TikTok）

---

## 目錄

1. [總覽](#總覽)
2. [架構與資料流](#架構與資料流)
3. [各階段詳細說明](#各階段詳細說明)
   - [Stage 1：語音轉錄（Whisper）](#stage-1語音轉錄)
   - [Stage 2：精華擷取（Gemini）](#stage-2精華擷取)
   - [Stage 3：裁切原始片段（FFmpeg）](#stage-3裁切原始片段)
   - [Stage 4：VoAI 語音合成（Hook 與 Outro）](#stage-4voai-語音合成)
   - [Stage 4.5：封面圖片編輯（kie.ai，選用）](#stage-45封面圖片編輯)
   - [Stage 5：Hedra 虛擬主播動畫](#stage-5hedra-虛擬主播動畫)
   - [Stage 6：B-Roll 素材（Pexels + kie.ai Veo）](#stage-6b-roll-素材)
   - [Stage 7：合併主音軌](#stage-7合併主音軌)
   - [Stage 8：組裝 Remotion Props](#stage-8組裝-remotion-props)
   - [Stage 9：Remotion 算圖](#stage-9remotion-算圖)
4. [Remotion 畫面組成](#remotion-畫面組成)
5. [字幕系統](#字幕系統)
6. [環境變數](#環境變數)
7. [暫存檔案與命名規則](#暫存檔案與命名規則)
8. [優雅降級機制](#優雅降級機制)
9. [關鍵常數與閾值](#關鍵常數與閾值)
10. [CLI 使用方式](#cli-使用方式)
11. [成本分析](#成本分析)

---

## 總覽

Pipeline 接收 **三個輸入**，產出一支精緻的直式短影音：

| 輸入 | 說明 |
|---|---|
| `audioPath` | 完整 Podcast 集數音檔（MP3/M4A） |
| `avatarImagePath` | Podcast 封面圖片（PNG/JPG） |
| `episodeTitle` | 集數標題字串（選填） |

**輸出**：`remotion/out/short_<timestamp>.mp4` — 40–60 秒、1080x1920、30fps

**核心設計原則**：每個外部 API 階段在缺少 API key 時，都會優雅降級為確定性的 stub。這代表你在開發/測試時不需要任何付費 API 就能跑完整個 pipeline。

---

## 架構與資料流

```
輸入：audio.mp3 + avatar.jpg + episodeTitle
                    |
    +---------------+------------------+
    |                                  |
[Stage 1: 語音轉錄]       [Airtable: 取得 podcast 講稿]
    |  (OpenAI Whisper)                |  （選用，需設定 AIRTABLE_API_KEY）
    |                                  |
    +--------> 01_transcript.json <----+
                    |
            [Stage 2: 精華擷取]
            |  (Gemini via OpenRouter)
            |
            |  Step 2a: Essence 預處理（從 Airtable 講稿提取 3-5 段精華候選）
            |  Step 2b: 主要精華選取（挑最佳片段，定位時間戳）
            |
            +-> 02_plan.json
            |   { hook_script, clips[], outro_script, broll_keywords, headline }
            |
    +-------+-------+
    |               |
[Stage 3]     [Stage 4: VoAI 語音合成]
 裁切片段      Hook 音檔 + Outro 音檔
 (FFmpeg)      （台灣腔中文，昱翔聲音）
    |               |
    |          +----+----+
    |          |         |
    |    [Stage 4.5]     |
    |    kie.ai 圖片     |  （選用：移除文字 + 9:16 擴展）
    |    編輯             |
    |          |         |
    |    [Stage 5: Hedra 動畫]
    |     Hook 影片 + Outro 影片
    |     (Character-3 對嘴動畫)
    |          |
    |    [Stage 6: B-Roll 素材]
    |     Pexels 素材庫 + kie.ai Veo 主視覺片段（選用）
    |          |
    +----+-----+
         |
   [Stage 7: 合併主音軌]
    hook.m4a + clip_*.m4a + outro.m4a  ->  07_master.m4a
         |
   [Stage 8: 組裝 Remotion Props]
    素材搬移 -> remotion/public/run_<ts>/
    計算字幕時間點
    -> 08_props.json
         |
   [Stage 9: Remotion 算圖]
    npx remotion render ShortVideo -> short_<ts>.mp4
         |
   輸出：1080x1920 MP4
```

---

## 各階段詳細說明

### Stage 1：語音轉錄

**檔案**：`src/services/shortsPipeline/transcribe.js`

**用途**：將 Podcast 音檔轉為結構化逐字稿，包含詞級（word-level）與句級（segment-level）時間戳。

**API 規格**：
| 欄位 | 值 |
|---|---|
| 端點 | `https://api.openai.com/v1/audio/transcriptions` |
| 方法 | POST（multipart form-data） |
| 驗證 | `Authorization: Bearer $OPENAI_API_KEY` |
| 模型 | `whisper-1`（預設，可透過 `WHISPER_MODEL` 覆蓋） |
| 語言提示 | `zh` |
| 回應格式 | `verbose_json` |
| 時間戳粒度 | `word` + `segment` |

**輸出**（`01_transcript.json`）：
```json
{
  "text": "完整逐字稿...",
  "language": "zh",
  "duration": 300.5,
  "segments": [
    { "id": 0, "start": 0.0, "end": 6.2, "text": "哈囉大家歡迎回到..." }
  ],
  "words": [
    { "word": "哈囉", "start": 0.0, "end": 0.4 }
  ]
}
```

**為什麼重要**：Whisper 的 `segments` 提供句級時間錨點。`words` 陣列雖然可用，但 pipeline 主要使用 segments（句級）來同步字幕，因為 Whisper 的中文詞邊界不夠可靠。

---

### Stage 2：精華擷取

**檔案**：`src/services/shortsPipeline/highlightExtractor.js`

**用途**：用 Gemini 找出最適合做成短影音的 32–48 秒片段，撰寫 hook/outro 旁白，並建議 B-roll 搜尋關鍵字。

#### Step 2a：Essence 預處理（Round 3 新增）

當 Airtable 提供了 `podcastScript` 時，會先執行一次**低成本 Gemini Flash 呼叫**，提取 3–5 段「精華候選」：

**Prompt 規則**：
- 每段候選必須是從講稿**逐字複製**的連續段落
- 長度：120–200 個中文字（約 30–60 秒唸讀量）
- 內容要求：有洞見、有數據、有品牌名、有戲劇轉折
- 禁止內容：開場白（「哈囉大家」）、結尾語、CTA、廣告段落（「贊助」/「折扣」/「BuildMoat」）

**輸出**：`{ "beats": [{ "text": "...", "reason": "..." }, ...] }`

如果此呼叫失敗，主要精華 prompt 會在沒有 beats 的情況下運行（不會造成功能退化）。

#### Step 2b：主要精華選取

Gemini 接收以下資料：
1. 完整 Whisper 逐字稿（含時間戳）
2. Airtable podcast 講稿（真實文字來源）
3. Essence beats 候選清單（來自 Step 2a）

**Prompt 中強制執行的嚴格規則**：
| 規則 | 說明 |
|---|---|
| 時間戳格式 | 必須是數字秒數（例如 `75.6`），絕不能用 `MM:SS` |
| clip.text 來源優先順序 | essence beats > podcast 講稿 > Whisper 字幕 |
| 片段總長度 | 32–48 秒（保留 12–18 秒給 hook+outro） |
| 最多片段數 | 2 段（盡量用 1 段） |
| 禁止開場白 | 排除「哈囉大家」「歡迎回到」「今天主題」 |
| 禁止結尾 CTA | 排除「記得訂閱」「點資訊欄」 |
| 禁止廣告 | 排除「贊助」「折扣」「課程連結」「限時優惠」「BuildMoat」 |
| 英文術語 | 保留原始拼法（ChatGPT、Claude Code、API） |

**輸出**（`02_plan.json`）：
```json
{
  "hook_script": "工程師們，還在為寫 Code 煩惱嗎？...",
  "clips": [
    {
      "start": 115.6,
      "end": 144.9,
      "text": "寫程式最痛苦的，不是解決 Logic 問題...",
      "reason": "這段生動描述了工程師的實際痛點"
    }
  ],
  "outro_script": "想知道更多 AI 工具...快點擊資訊欄連結！",
  "broll_keywords": ["programmer coding", "ai tools", "developer workflow"],
  "headline": "AI 時代，工程師如何升級？"
}
```

**JSON 容錯機制**：解析器能處理 markdown 程式碼框、尾部逗號、全形引號、以及 MM:SS→秒數轉換 — 依序嘗試 6 種修復策略。

---

### Stage 3：裁切原始片段

**檔案**：`src/services/shortsPipeline/audioCutter.js`

**用途**：從完整 Podcast 音檔中擷取被選中的精華音訊片段。

**FFmpeg 指令**：
```bash
ffmpeg -y -nostdin -ss <start> -t <duration> -i "<input>" \
  -c:a aac -b:a 192k -ar 44100 "<output>"
```

**輸出**：`clips/clip_1.m4a`、`clips/clip_2.m4a`（如果選了 2 段）

---

### Stage 4：VoAI 語音合成

**檔案**：`src/services/shortsPipeline/voai.js`

**用途**：為 hook 開場白和 outro CTA 合成台灣腔中文旁白。

**語音設定**：
| 參數 | 值 |
|---|---|
| 聲音名稱 | 昱翔（男聲） |
| 風格 | 預設 |
| 版本 | Neo |
| 語速 | **1.25 倍** |
| 音高偏移 | 1.5 |
| 風格權重 | 0.8 |
| 呼吸停頓 | 0.15 秒 |

**API 規格**：
| 欄位 | 值 |
|---|---|
| 端點 | `https://connect.voai.ai/TTS/generate-dialogue` |
| 方法 | POST |
| 驗證 | `x-api-key: $VOAI_API_KEY` |
| 輸出格式 | `x-output-format: mp3` |

**Payload 結構**：
```json
{
  "input": {
    "dialogue": [{
      "voai_script_text": "清理後的文字（雙引號已移除）",
      "voice": { "name": "昱翔", "style": "預設", "version": "Neo" },
      "audio_config": { "speed": 1.25, "pitch_shift": 1.5, "style_weight": 0.8, "breath_pause": 0.15 }
    }]
  }
}
```

**分段邏輯**：
1. 以句號分段：`[。？！]`
2. 將句子打包成最多 300 字的 chunk
3. 過短的孤立句子（<5 個可見字元，如「嗯。」）會合併到下一個 chunk
4. 每次處理 5 個 chunk，batch 之間間隔 1.5 秒
5. 透過 FFmpeg concat demuxer 串接各 chunk（stream copy）

**輸出**：`04_hook.m4a`、`04_outro.m4a`

---

### Stage 4.5：封面圖片編輯

**檔案**：`src/services/shortsPipeline/kieai.js`

**啟用條件**：`ENABLE_KIE_IMAGE_EDIT=true`

**用途**：移除 Podcast IG 封面上嵌入的文字，並擴展成 9:16 直式圖片供 Hedra 使用。

**流程**：
1. 上傳原始圖片到 `tmpfiles.org`（免費公開 URL，1 小時有效）
2. 提交編輯任務到 kie.ai `google/nano-banana-edit` 模型
3. 每 5 秒輪詢 `api.kie.ai/api/v1/jobs/recordInfo`（最多 60 次 = 5 分鐘）
4. 下載結果，透過 sharp 正規化為 1080x1920

**API 規格**：
| 欄位 | 值 |
|---|---|
| 提交端點 | `https://api.kie.ai/api/v1/jobs/createTask` |
| 輪詢端點 | `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=<id>` |
| 驗證 | `Authorization: Bearer $KIE_AI_API_KEY` |
| 模型 | `google/nano-banana-edit` |
| 圖片尺寸 | `9:16` |
| 輸出格式 | `png` |

**預設編輯指令**：移除所有中文字、標題、文字及 Logo，以相符背景擴展為 9:16 比例。

**輸出**：`04b_avatar_clean.png`（1080x1920）

**成本**：約 $0.02/張

**未啟用或失敗時**：Pipeline 直接使用原始封面圖片。

---

### Stage 5：Hedra 虛擬主播動畫

**檔案**：`src/services/shortsPipeline/hedra.js`

**用途**：將樹懶虛擬主播圖片與音檔結合，產生對嘴的說話影片覆蓋層。

**流程**（4 步驟素材上傳 + 生成）：
1. 建立圖片素材 → POST `/assets`（type: "image"）→ 取得素材 ID
2. 上傳圖片二進位 → POST `/assets/{id}/upload`（multipart）
3. 建立音訊素材 → POST `/assets`（type: "audio"）→ 取得素材 ID
4. 上傳音訊二進位 → POST `/assets/{id}/upload`（multipart）
5. 啟動生成 → POST `/generations`（包含兩個素材 ID）
6. 輪詢 → GET `/generations/{id}/status` 每 5 秒一次，直到 `status == "complete"`（10 分鐘逾時）
7. 下載 → GET 預簽名 `download_url`

**API 規格**：
| 欄位 | 值 |
|---|---|
| Base URL | `https://api.hedra.com/web-app/public` |
| 驗證 | `x-api-key: $HEDRA_API_KEY` |
| 模型 | Character-3（`d1dd37a3-e39a-4854-a298-6510289f9cf2`） |
| 解析度 | 720p |
| 比例 | 9:16 |
| 提示詞 | "A friendly sloth podcast host speaking directly to camera" |

**呼叫兩次**（依序執行）：
1. Hook：圖片 + `04_hook.m4a` → `05_sloth_hook.mp4`
2. Outro：圖片 + `04_outro.m4a` → `05_sloth_outro.mp4`

**備註**：Hedra 呼叫是整個 pipeline 的瓶頸（每次約 60–80 秒）。目前為依序執行；平行化是未來的優化方向。

---

### Stage 6：B-Roll 素材

#### 6a：Pexels 素材庫影片

**檔案**：`src/services/shortsPipeline/pexels.js`

**用途**：下載免版稅的直式素材影片，作為精華片段的 B-roll 背景。

**API 規格**：
| 欄位 | 值 |
|---|---|
| 端點 | `https://api.pexels.com/videos/search` |
| 驗證 | `Authorization: $PEXELS_API_KEY` |
| 方向 | `portrait`（直式） |
| 每頁筆數 | 10 |
| 最短長度 | 8 秒 |
| 偏好品質 | HD（寬度 >= 720） |

**輸出**：`broll/broll_<keyword>_<id>.mp4`（每個 Stage 2 的關鍵字各一支）

#### 6b：kie.ai Veo 主視覺片段（選用）

**啟用條件**：`ENABLE_KIE_HERO_BROLL=true`

**用途**：用 Veo 3 Fast 生成一段 8 秒的電影感 AI 直式影片，放在第一個 B-roll 位置。

**API 規格**：
| 欄位 | 值 |
|---|---|
| 提交 | `https://api.kie.ai/api/v1/veo/generate` |
| 輪詢 | `https://api.kie.ai/api/v1/veo/record-info?taskId=<id>` |
| 模型 | Veo 3 Fast |
| 時長 | 固定 8 秒 |
| 輪詢間隔 | 30 秒（最多 20 次 = 10 分鐘） |

**Prompt 模板**：
> "Cinematic vertical 9:16 shot, \<keyword\>, shallow depth of field, dynamic camera motion, vibrant volumetric lighting, high detail, shot on Arri Alexa, photorealistic, 8 second clip"

**輸出**：`broll/hero_veo.mp4`

**成本**：約 $0.30/片段

---

### Stage 7：合併主音軌

**檔案**：`src/services/shortsPipeline/audioCutter.js`

**用途**：將所有音訊片段串接成一個連續的主音軌。

**串接順序**：`hook.m4a` → `clip_1.m4a` [→ `clip_2.m4a`] → `outro.m4a`

**FFmpeg 指令**（使用 concat filter 而非 demuxer — 可處理 mono/stereo 不一致）：
```bash
ffmpeg -y -nostdin \
  -i hook.m4a -i clip_1.m4a -i outro.m4a \
  -filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]" \
  -map "[out]" -c:a aac -b:a 192k -ar 44100 -ac 2 master.m4a
```

**輸出**：`07_master.m4a`（stereo、AAC、192kbps、44.1kHz）

---

### Stage 8：組裝 Remotion Props

**檔案**：`src/services/shortsPipeline/index.js`

**用途**：將所有 pipeline 產出組裝成一份 JSON props 檔案給 Remotion，並將素材搬移到 `remotion/public/` 目錄。

**素材搬移**：所有檔案從 `temp/shorts_<ts>/` 複製到 `remotion/public/run_<ts>/`，讓 Remotion 的 `staticFile()` 能正確解析路徑。

**字幕建構**（詳見[字幕系統](#字幕系統)）：
- Hook 字幕：從 VoAI 腳本文字製造（均勻分配時間）
- 片段字幕：錨定至 Whisper 句級時間戳，使用 Gemini 修正後的文字
- Outro 字幕：從 VoAI 腳本文字製造（均勻分配時間）

**B-roll 分配**：將 B-roll 片段均勻分佈在片段時間軸上。

**輸出**（`08_props.json`）：
```json
{
  "audioSrc": "run_<ts>/master.m4a",
  "avatarImageSrc": "run_<ts>/avatar.png",
  "headline": "AI 時代，工程師如何升級？",
  "captions": [
    {
      "text": "工程師們，",
      "start": 0.0,
      "end": 1.2,
      "words": [
        { "word": "工程", "start": 0.0, "end": 0.4 },
        { "word": "師們", "start": 0.4, "end": 0.8 },
        { "word": "，", "start": 0.8, "end": 1.2 }
      ]
    }
  ],
  "totalDurationSec": 55.3,
  "slothHookVideoSrc": "run_<ts>/sloth_hook.mp4",
  "slothOutroVideoSrc": "run_<ts>/sloth_outro.mp4",
  "hookDurationSec": 5.5,
  "outroDurationSec": 6.2,
  "brollClips": [
    { "src": "run_<ts>/broll_0.mp4", "start": 5.5, "end": 20.3 }
  ]
}
```

---

### Stage 9：Remotion 算圖

**檔案**：`src/services/shortsPipeline/index.js`

**指令**：
```bash
cd remotion && npx remotion render src/index.ts ShortVideo \
  "<output_path>" --props=<08_props.json path>
```

**畫面規格**（來自 `remotion/src/Root.tsx`）：
| 規格 | 值 |
|---|---|
| 幀率 | 30 fps |
| 寬度 | 1080 |
| 高度 | 1920 |
| 時長 | `props.totalDurationSec * 30` 幀 |
| 影片編碼 | H.264（libx264） |
| 音訊編碼 | AAC |
| 容器格式 | MP4 |

**輸出**：`remotion/out/short_<ts>.mp4`

---

## Remotion 畫面組成

**檔案**：`remotion/src/ShortVideo.tsx`

### 視覺圖層堆疊（由底至頂）

| 圖層 | Z 順序 | 時段 | 說明 |
|---|---|---|---|
| 模糊背景 | 1 | 全程 | 模糊 + 變暗的封面圖片（Ken Burns 緩慢放大 1.0→1.08 倍） |
| B-Roll | 2 | 僅片段時段 | Pexels/Veo 影片，微幅放大 1.02→1.06 倍，暗色漸層覆蓋 |
| Hook 前景 | 3 | 0 → hook 結束 | SlothOverlay（Hedra 對嘴影片或靜態圖片備援），820x820 圓角方塊 |
| 片段前景 | 3 | hook → outro | CoverCenter（僅在無 B-roll 時顯示），同 820x820 圓角方塊 |
| Outro 前景 | 3 | outro 開始 → 結尾 | SlothOverlay（Hedra 對嘴影片或靜態圖片備援） |
| 標題膠囊 | 4 | Hook + Outro | 動態黃色膠囊 — 彈入、停留、淡出（片段時段完全隱藏） |
| 字幕 | 5 | 逐段 | 逐字高亮顯示於畫面下方 |
| 音訊 | — | 全程 | 主音軌 |

### 標題動畫（AnimatedHeadline 元件）

| 階段 | 時間 | 動畫效果 |
|---|---|---|
| Hook 進入 | 第 0–14 幀 | Spring translateY 從 -120px 到 0，透明度 0→1 |
| Hook 停留 | 第 14 幀 → hookFrames-6 | 維持 100% 透明度 |
| Hook 退出 | hookFrames-6 → hookFrames | 線性淡出 透明度 1→0 |
| 片段時段 | hookFrames → outroStart | **完全隱藏**（return null） |
| Outro 進入 | outroStart → outroStart+14 | Spring translateY 從 -120px 到 0，透明度 0→1 |
| Outro 停留 | outroStart+14 → totalFrames-8 | 維持 100% 透明度 |
| Outro 退出 | totalFrames-8 → totalFrames | 線性淡出 透明度 1→0 |

**樣式**：黃色膠囊（`rgba(255, 220, 70, 0.95)`），64px 字體，weight 900，border-radius 999，置中於頂部 paddingTop 80px。

### 字幕渲染（AnimatedCaption 元件）

**檔案**：`remotion/src/components/AnimatedCaption.tsx`

**兩種模式**：

1. **逐字高亮**（有 `words[]` 時 — 標準模式）：
   - 每個字為一個 `<span>`，依狀態設定樣式：
     - **正在唸**（active）：黃色 `#ffd93d`，放大 1.12 倍，spring 彈跳（8 幀，stiffness 260）
     - **已唸過**（past）：白色 `#ffffff`
     - **尚未唸**（future）：半透明 `rgba(255,255,255,0.55)`

2. **備援模式**（無 words）：整段文字，從下方 40px 彈入

**樣式**：72px 字體，PingFang TC / Noto Sans TC，weight 800，半透明黑色背景（`rgba(0,0,0,0.78)`），最大寬度 920px，定位於畫面下方（paddingBottom 280px）。

### B-Roll 渲染（BRollLayer 元件）

**檔案**：`remotion/src/components/BRollLayer.tsx`

每段 B-roll 片段：
- OffthreadVideo（靜音），滿版 1080x1920
- 微幅置中放大：1.02 → 1.06 倍
- 暗色漸層覆蓋確保字幕可讀性

### 樹懶覆蓋層（SlothOverlay 元件）

**檔案**：`remotion/src/components/SlothOverlay.tsx`

- 有 Hedra 影片時：OffthreadVideo（靜音），820x820 圓角方塊
- 備援：靜態 Img（封面圖片）
- 進入動畫：scale 0.94 → 1.0（第 0–8 幀）
- 定位：畫面中央，paddingTop 200px

---

## 字幕系統

### 三種字幕來源

| 來源 | 計時方式 | 文字來源 |
|---|---|---|
| Hook | 製造式（均勻分配） | VoAI `hook_script` |
| 片段 | 句級錨定（Whisper segments） | Gemini 修正後的 `clip.text` |
| Outro | 製造式（均勻分配） | VoAI `outro_script` |

### 字幕分段流程

1. **移除空白**：所有空格移除（中文不需要空格）
2. **依斷點切割**：`，。！？、；：,.!?;:`
3. **貪心打包**：將切割後的片段打包成最多 **16 個可見字元**的 chunk
4. **溢位處理**：若單一片段超過 16 字元，重新 tokenize 後逐 token 打包
5. **將每個 chunk tokenize** 以產生逐字高亮時間

### Tokenizer（CAPTION_TOKEN_RE）

```regex
/[A-Za-z0-9]+(?:[''][A-Za-z0-9]+)?|[\u4e00-\u9fff]{1,2}|[^\s]/g
```

| 輸入 | Tokens |
|---|---|
| `工程師們，還在為寫Code煩惱` | `["工程","師們","，","還在","為寫","Code","煩惱"]` |
| `AI已經能代勞了！` | `["AI","已經","能代","勞了","！"]` |
| `ChatGPT和ClaudeCode` | `["ChatGPT","和","ClaudeCode"]` |
| `2025年AI大爆發` | `["2025","年","AI","大爆","發"]` |

重點：英文單字（`Code`、`AI`、`ChatGPT`）和數字（`2025`）**絕不會被拆開**。

### 句級錨定的片段字幕（pushClipCaptionsSynced）

片段字幕會同步到真實語速，而非均勻分配：

1. 找出與 `[clip.start, clip.end]` 重疊的 Whisper segments
2. 將每個 segment 的時間區間映射到主時間軸
3. 依每個錨點的持續時間，按字元數比例分配 `clip.text`
4. 每個切片 → `pushFabricatedCaptions()` 產生顯示用的 chunk

這樣可以避免字幕在 40 秒的片段中逐漸與語音脫節。

---

## 環境變數

### 正式環境必需

| 變數 | 服務 | 用途 |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI | Whisper 語音轉錄 |
| `OPENROUTER_API_KEY` | OpenRouter | Gemini 精華擷取 |
| `VOAI_API_KEY` | VoAI 絕好聲創 | 台灣腔中文語音合成 |
| `HEDRA_API_KEY` | Hedra | Character-3 對嘴動畫 |
| `PEXELS_API_KEY` | Pexels | B-roll 素材影片下載 |

### 建議設定

| 變數 | 預設值 | 用途 |
|---|---|---|
| `AIRTABLE_API_KEY` | — | 取得真實 podcast 講稿 |
| `AIRTABLE_BASE_ID` | `app19Zwdzq4sWcREm` | Airtable base |
| `AIRTABLE_TABLE_NAME` | `Daily Podcast Summary` | Airtable table |

### 功能開關

| 變數 | 預設值 | 用途 |
|---|---|---|
| `ENABLE_KIE_IMAGE_EDIT` | `false` | 啟用 kie.ai 封面文字移除 + 9:16 擴展 |
| `ENABLE_KIE_HERO_BROLL` | `false` | 啟用 kie.ai Veo 3 Fast 主視覺 B-roll |
| `KIE_AI_API_KEY` | — | 任一 kie.ai 功能皆需此 key |

### 覆蓋設定

| 變數 | 預設值 | 用途 |
|---|---|---|
| `WHISPER_MODEL` | `whisper-1` | 可設為 `gpt-4o-transcribe` |
| `HEDRA_API_BASE` | `https://api.hedra.com/web-app/public` | Hedra API base URL |
| `HEDRA_MODEL_ID` | `d1dd37a3-e39a-4854-a298-6510289f9cf2` | Hedra Character-3 模型 UUID |

---

## 暫存檔案與命名規則

**根目錄**：`temp/shorts_<ISO-timestamp>/`

```
temp/shorts_2026-04-09T22-41-23-824Z/
  01_transcript.json          # Whisper 輸出（segments + words）
  02_plan.json                # 精華計畫（clips、scripts、keywords）
  04_hook.m4a                 # VoAI hook 旁白
  04_outro.m4a                # VoAI outro 旁白
  04b_avatar_clean.png        # kie.ai 編輯後的封面（若啟用）
  05_sloth_hook.mp4           # Hedra hook 對嘴影片
  05_sloth_outro.mp4          # Hedra outro 對嘴影片
  07_master.m4a               # 合併後的主音軌
  08_props.json               # Remotion 畫面組成 props
  99_manifest.json            # 完整 pipeline 摘要
  clips/
    clip_1.m4a                # 擷取的音訊片段 1
    clip_2.m4a                # （若選了 2 段片段）
  broll/
    broll_<keyword>_<id>.mp4  # Pexels 下載
    hero_veo.mp4              # kie.ai Veo 片段（若啟用）
```

**搬移後的素材**（供 Remotion 使用）：`remotion/public/run_<ts>/` — 在 `finally` 區塊中於算圖後清除。

---

## 優雅降級機制

| 階段 | 缺少的 Key | 備援行為 |
|---|---|---|
| 1 語音轉錄 | `OPENAI_API_KEY` | 120 秒假中文文字，均勻分配時間 |
| 2 精華擷取 | `OPENROUTER_API_KEY` | 取逐字稿中間 40 秒，使用預設腳本 |
| 2a Essence | Airtable 不可用 | 跳過；精華擷取在無候選清單的情況下執行 |
| 4 VoAI | `VOAI_API_KEY` | 靜音音檔，時長根據文字長度估算 |
| 4.5 圖片編輯 | 未啟用或失敗 | 使用原始封面圖片 |
| 5 Hedra | `HEDRA_API_KEY` | 靜態圖片循環播放至音訊長度（FFmpeg） |
| 6 Pexels | `PEXELS_API_KEY` | 漸層影片（6 種配色，每段 10 秒） |
| 6b Veo | 未啟用 | 跳過；僅使用 Pexels B-roll |

Stage 3、7、9 需要 FFmpeg / Remotion CLI — 無備援（硬依賴）。

---

## 關鍵常數與閾值

### 影片輸出
| 參數 | 值 |
|---|---|
| 解析度 | 1080 x 1920（9:16） |
| 幀率 | 30 fps |
| 目標時長 | 40–60 秒 |
| 片段時長 | 32–48 秒 |
| Hook + Outro 預算 | 12–18 秒 |

### VoAI 語音合成
| 參數 | 值 |
|---|---|
| 聲音 | 昱翔（Neo） |
| 語速 | 1.25 倍 |
| 音高偏移 | 1.5 |
| Chunk 最大長度 | 300 字元 |
| Batch 大小 | 5 個 chunk |
| Batch 間隔 | 1500ms |

### 字幕
| 參數 | 值 |
|---|---|
| 最大 chunk 寬度 | 16 個可見字元 |
| 中文分組 | 2 字為一拍 |
| 字幕字型大小 | 72px |
| 字幕最大寬度 | 920px |
| 字幕底部間距 | 280px |
| 正在唸的字顏色 | #ffd93d（黃色） |

### 標題膠囊
| 參數 | 值 |
|---|---|
| 字型大小 | 64px |
| 背景色 | rgba(255, 220, 70, 0.95) |
| 圓角 | 999（全圓膠囊） |
| Spring 動畫時長 | 約 14 幀（0.47 秒） |
| 淡出時長 | 6 幀（0.2 秒） |

### Hedra
| 參數 | 值 |
|---|---|
| 模型 | Character-3 |
| 解析度 | 720p |
| 比例 | 9:16 |
| 輪詢間隔 | 5 秒 |
| 逾時 | 10 分鐘 |

### kie.ai
| 參數 | Veo 主視覺 | 圖片編輯 |
|---|---|---|
| 時長 | 固定 8 秒 | 不適用 |
| 輪詢間隔 | 30 秒 | 5 秒 |
| 逾時 | 10 分鐘 | 5 分鐘 |
| 每次成本 | 約 $0.30 | 約 $0.02 |

---

## CLI 使用方式

### 進入點

```bash
node scripts/generate-short.js \
  [--audio=<path>]   \
  [--avatar=<path>]  \
  [--title=<string>] \
  [--output=<path>]
```

### 預設值
- `--audio`：`remotion/assets/test-audio.mp3`
- `--avatar`：`remotion/assets/test-cover.jpg`
- `--title`：（空）
- `--output`：`remotion/out/short_<timestamp>.mp4`

### 範例

```bash
# 開發模式（全部使用 stub — 不需要 API key）
node scripts/generate-short.js

# 完整正式執行（含 kie.ai 功能）
ENABLE_KIE_IMAGE_EDIT=true ENABLE_KIE_HERO_BROLL=true \
  node scripts/generate-short.js \
  --audio=/path/to/episode.mp3 \
  --avatar=/path/to/cover.jpg \
  --title="EP123: 今天的 AI 大新聞"
```

### 程式化呼叫

```javascript
const { runShortsPipeline } = require('./src/services/shortsPipeline');

await runShortsPipeline({
  audioPath: '/path/to/episode.mp3',
  avatarImagePath: '/path/to/cover.jpg',
  episodeTitle: 'EP123: 今天的 AI 大新聞',
});
```

---

## 成本分析

啟用所有功能時，每次執行的預估成本：

| 服務 | 階段 | 成本 |
|---|---|---|
| OpenAI Whisper | 語音轉錄 | 約 $0.06（5 分鐘音檔 @ $0.006/分鐘） |
| OpenRouter Gemini Flash | Essence + 精華擷取 | 約 $0.01（2 次呼叫） |
| VoAI TTS | Hook + Outro | 約 $0.05 |
| Hedra Character-3 | 2 次動畫 | 約 $0.30 |
| Pexels | B-roll | 免費 |
| kie.ai Veo | 主視覺片段 | 約 $0.30（若啟用） |
| kie.ai nano-banana-edit | 圖片編輯 | 約 $0.02（若啟用） |
| **合計** | | **約 $0.74** |

不含 kie.ai 功能時：約 $0.42/次

---

## Airtable 整合

**資料表**：`Daily Podcast Summary`（base：`app19Zwdzq4sWcREm`）

**方法**：`AirtableService.getLatestPodcastScript()`

**查詢條件**：
- 篩選：`NOT({podcast script} = '')`
- 排序：`Date` 降序
- 限制：1 筆

**回傳值**：
```javascript
{
  recordId: "rec...",
  date: "2026-04-09",
  script: "完整講稿...",      // 用來合成 TTS 音檔的真實文字
  title: "Episode Title"     // 來自 Youtube Title1 或 Title 欄位
}
```

**為什麼重要**：Airtable 講稿是 podcast 實際內容的**真實來源**（因為音檔是由這份講稿透過 TTS 合成的）。使用它而非 Whisper 的輸出，可以消除字幕中的轉錄錯誤，並讓 Essence 預處理能從真正的文字中挑選精華。

**已知限制**：`getLatestPodcastScript()` 目前永遠回傳最新一筆資料，不會去比對正在處理的音檔。如果 Airtable 最新一筆與正在處理的音檔不對應，講稿內容會不匹配（此修正已延後）。
