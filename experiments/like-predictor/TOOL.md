# 爆文評分工具 — 使用說明

把實驗勝出的 Approach A 包成一個常駐評分服務，讓 voice-writer 的「生 5 版挑最爆」自我優化迴圈呼叫。

## 架構

```
/write 頁面 ──► /api/voice/write {bestOf:5}
                      │
                      ▼
        writeBestOfN()  (src/services/voice/writer.ts)
          1. Gemini 生成 5 版不同角度草稿 (並發)
          2. predictorClient.scoreDrafts() ──HTTP──► score_service.py:8765
          3. 依 viral_prob 排序,回傳最高分 + 候選清單
                      │
                      ▼   (服務離線時 graceful fallback:回第一版、不阻斷)
        bundle.joblib  ←─ train_model.py 產出 (含你 521 篇個人化)
```

## 元件

| 檔案 | 用途 |
|------|------|
| `train_model.py` | 訓練雙頭模型(relative_score 迴歸 + viral_prob 分類),存 `model/bundle.joblib` |
| `model_core.py` | FeaturePipe + ModelBundle(特徵工程 + 兩個 GBDT 頭) |
| `scorer.py` | 載入 bundle、對單/多篇打分 |
| `score_service.py` | zero-dep HTTP 服務(stdlib),保溫模型 |
| `src/services/voice/predictorClient.ts` | TS 端 client(含 graceful fallback) |
| `src/services/voice/writer.ts` → `writeBestOfN()` | 生 N 版挑最爆 |

## 啟動評分服務

```bash
cd experiments/like-predictor
python3 score_service.py --port 8765      # 前景
# 或常駐(launchd):
cp com.podcast.likepredictor.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.podcast.likepredictor.plist
```

健康檢查:`curl http://127.0.0.1:8765/health`

> voice-writer 透過環境變數 `LIKE_PREDICTOR_URL`(預設 `http://127.0.0.1:8765`)連線。
> **服務沒開也不會壞** — 只是不評分,照常出稿。

## 重新訓練(資料更新後)

```bash
cd experiments/like-predictor
python3 train_model.py     # 重讀 CSV + threads_posts + trend_posts,重存 bundle
# 改完記得重啟服務讓它載入新模型
```

## 測試

```bash
python3 scorer.py                              # 單機評分 sanity
curl -X POST localhost:8765/score -d '{"text":"..."}'   # 服務
cd ../../dashboard && npx tsx scripts/test-best-of-n.ts # e2e(需服務在跑)
```

## 已知限制

- 訊號中等(你自己貼文 held-out:爆文 ROC-AUC ≈0.69、作者內排序 pairwise ≈0.57)。定位是**篩選/第二意見**,不是準確讚數預言。
- 作者預設綁定 `ai.lanrenbao`(你的 baseline)。換帳號要在 `scoreDrafts(texts, author)` 傳入。
- 模型靜態。新貼文要靠 `train_model.py` 重訓才會學到。
