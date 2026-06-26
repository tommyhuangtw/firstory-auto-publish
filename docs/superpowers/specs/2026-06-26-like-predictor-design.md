# 社群流量 Predictor — 設計文件

**日期**: 2026-06-26
**Branch**: `feat/like-predictor`
**狀態**: 已核准，實作中

## 目標

打造一個輔助工具，幫助評估 Threads 貼文草稿的表現潛力。**不是**預測確切讚數（因資料缺粉絲數，絕對數字無法準確預測），而是聚焦兩個務實用途：

1. **草稿排序** — 給定多個草稿版本，排序「哪篇最可能表現好」
2. **爆文判斷** — 判斷一篇貼文會不會「爆」（相對於作者自己的水準）

## 資料

| 來源 | 筆數 | 用途 |
|------|------|------|
| `public_posts_raw_rows_threadify.csv` | 12,157 篇 / 165 作者 | 主訓練集 |
| `threads_posts` (DB) | 521 篇 (Tommy 本人) | 個人驗證集 / 風格層 |
| `trend_posts` (DB) | 3,449 篇 (每日熱點) | 擴充資料 |

**可用特徵**: `content_text`、`posted_at`、`has_media`、`threads_username`(作者)
**不可用**: `reply_count` / `repost_count`（CSV 中全為 0；且用互動數預測讚數屬 leakage）

**讚數分布**: 極度右偏 log-normal — 中位數 15、平均 140、P90 173、P99 2358、max 96579。

## 核心設計決策

### 1. 預測目標 = 作者相對基準（移除粉絲數干擾）

```
target = log(1 + likes) − log(1 + 該作者中位數讚數)
```

理由：讚數最大決定因素是作者觸及/粉絲數，但資料無此欄位。用作者相對 z-score 可移除此干擾，逼模型學「內容品質」——正好就是比較同帳號草稿時需要的能力。

### 2. 「爆」的定義 = 作者自己的 P90

一篇貼文讚數 ≥ 該作者前 10% 門檻 → 標記為爆文 (label=1)。比絕對門檻對大小帳號更公平。

### 3. 時間切分（避免 leakage）

依 `posted_at` 排序，早期 80% 訓練、近期 20% 測試。模擬「用過去資料預測未來貼文」的真實情境。

## 三種方法（實驗對照組）

| # | 方法 | 特徵 / 模型 | 特點 |
|---|------|------------|------|
| **A** | 古典 ML + 手工特徵 | TF-IDF + 結構特徵（長度/emoji/媒體/時段/問句/數字/開頭鉤子）+ 作者特徵 → LightGBM/GradientBoosting | 快、可解釋、強 baseline |
| **B** | 語意 Embedding | 多語 sentence-transformer embedding + metadata → 迴歸器 | 抓語意內容 |
| **C** | LLM 評分 | OpenRouter few-shot，讓 LLM 對草稿打爆紅潛力分 | 零訓練、有世界知識，有 API 成本 |

三種共用同一份 train/test 切分與同一套 metrics，公平比較。

## 評測指標（對準用途）

**排序能力**（草稿比較）:
- Spearman ρ（整體）
- **作者內 Spearman ρ**（最關鍵 — 模擬比較同帳號草稿）
- 兩兩比較正確率 (pairwise accuracy)

**爆文判斷**（分類）:
- AUC-ROC、PR-AUC
- F1、Precision@10

**次要 sanity**: log-likes 的 MAE / RMSE

## 架構

```
experiments/like-predictor/
├── data_loader.py      # 載入 CSV + DB，清洗，作者基準計算，時間切分
├── features.py         # 手工特徵工程 (方法 A)
├── eval.py             # 共用評測 harness（所有 metrics）
├── approach_a_classical.py
├── approach_b_embedding.py
├── approach_c_llm.py
├── run_comparison.py   # 跑三方法 → 輸出比較表
└── results/            # metrics JSON + 比較報告
```

**共用介面**: 每個 approach 實作 `train(train_df)` → `predict(test_df) -> scores`，由 `eval.py` 統一評測。

## 成功標準

1. 三種方法都能跑出完整 metrics
2. `run_comparison.py` 輸出一張並排比較表
3. 至少一種方法的**作者內 Spearman ρ > 0.2**（證明有學到內容訊號，非純猜作者）
4. 選出 accuracy 最高者，記錄為輔助工具建議

## 範圍外 (YAGNI)

- 不做即時 API / UI 整合（先驗證方法可行）
- 不預測確切讚數
- 不做 reply/repost 預測
