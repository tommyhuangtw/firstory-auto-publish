# 爆文評分工具 + best-of-N 自我優化 — 設計文件

**日期**: 2026-06-26 · **Branch**: `feat/like-predictor` · **狀態**: 已實作 + e2e 驗證

延續實驗結論（見 `2026-06-26-like-predictor-design.md`，Approach A 勝出），把模型產品化成工具，讓 voice-writer 自我優化。

## 決策（已與 Tommy 確認）

| 問題 | 決定 |
|------|------|
| 自我 tune 方式 | **生 N 版 → 評分 → 挑最好**（不做迭代改寫） |
| 個人化 | **重訓含 Tommy 521 篇**（`ai.lanrenbao` baseline） |
| 公開分享 | **僅當內容素材**（不做公開工具） |
| 整合形式 | **Python 微服務**（stdlib，非搬 TS / 非每次 spawn） |
| N | 5 |
| 主排序鍵 | `viral_prob`（最在意爆文）→ tiebreak `relative_score` |

## 架構

`/write` → `/api/voice/write {bestOf:5}` → `writeBestOfN()`:
1. Gemini 並發生成 5 版不同角度草稿（沿用既有 `VARIETY_NUDGES`，改成依 index 取得確定角度）
2. `predictorClient.scoreDrafts()` → HTTP → `score_service.py`（保溫模型）
3. 依 viral_prob 排序，回傳 best + ranked candidates

模型：`train_model.py` 訓練雙頭 `ModelBundle`（relative_score 迴歸 + viral_prob 分類），存 `model/bundle.joblib`（gitignored，可重訓重生）。

## 隔離與安全

- **Graceful fallback**：評分服務離線時回第一版、`scored=false`，**不阻斷寫作**。
- 模型綁定作者 `ai.lanrenbao`；換帳號傳 `scoreDrafts(texts, author)`。
- worktree 用 symlink 接主 tree 的 node_modules/.env.local/podcast.db（唯讀 voice_assets/stories）。

## 驗證結果

- 個人 held-out（你的貼文 n=149）：爆文 ROC-AUC **0.69**、作者內排序 pairwise **0.57**。
- e2e：5 版評分排序，best 19.5% vs worst 6.7%，排序不變量 PASS；離線 fallback PASS；`npm run build` PASS。

## 限制（誠實揭露）

訊號中等。定位＝**篩選 + 第二意見**，不是準確讚數預言。模型靜態，需 `train_model.py` 重訓才學新貼文。

## 範圍外

公開工具 UI、多帳號冷啟動、迭代改寫、即時線上學習。
