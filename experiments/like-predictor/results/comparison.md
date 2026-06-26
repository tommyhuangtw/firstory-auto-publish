# Like Predictor — Comparison Report

Dataset: train=9627 test=2390 authors_train=158 viral_rate_train=0.113 viral_rate_test=0.082

Target: target=log1p(likes)-log1p(author_median); viral=likes>=author_p90; baseline from TRAIN only

## Full test set (A & B)

| Approach | Spearman(overall) | Spearman(within-author) | Pairwise Acc | ROC-AUC | PR-AUC | F1 | P@10 |
|---|---|---|---|---|---|---|---|
| A: Classical (TF-IDF + GBDT) | 0.1575 | 0.2906 | 0.5949 | 0.6253 | 0.138 | 0.1888 | 0.3 |
| B: Embedding (multilingual MiniLM + GBDT) | 0.1123 | 0.3058 | 0.602 | 0.6124 | 0.1316 | 0.1429 | 0.4 |
| C: LLM (OpenRouter few-shot) | 0.2515 | 0.1514 | 0.3806 | 0.7064 | 0.1319 | 0.225 | 0.1 |
| (sample) A: Classical (TF-IDF + GBDT) | 0.1859 | 0.3539 | 0.626 | 0.7228 | 0.2777 | 0.1875 | 0.3 |
| (sample) B: Embedding (multilingual MiniLM + GBDT) | 0.1662 | 0.3177 | 0.6425 | 0.6681 | 0.2047 | 0.125 | 0.2 |

Headline metric = **Spearman(within-author)**: can the model rank a single account's own posts by engagement (i.e. pick the better draft).
