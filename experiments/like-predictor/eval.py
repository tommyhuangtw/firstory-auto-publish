"""Shared evaluation harness.

Every approach outputs a single continuous `score` per test row (higher = more
likes expected, author-relative). We evaluate that score two ways, matching the
two real use cases:

  1. Ranking  — "which draft is better?"  -> Spearman, within-author Spearman,
                pairwise accuracy.
  2. Viral    — "will it 爆?"             -> ROC-AUC, PR-AUC, F1, Precision@10
                on the is_viral label.

The score does not need to be calibrated to a like count; only its *ordering*
matters, which is exactly what the use cases need.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import average_precision_score, f1_score, roc_auc_score


def _within_author_spearman(df: pd.DataFrame, score_col: str, truth_col: str) -> float:
    """Average Spearman computed *within* each author, weighted by post count.

    This is THE headline metric: comparing your own drafts means author is held
    constant, so the model must rank on content, not on which account posts it.
    """
    rhos, weights = [], []
    for _, g in df.groupby("author"):
        if len(g) < 4 or g[truth_col].nunique() < 2:
            continue
        rho, _ = spearmanr(g[score_col], g[truth_col])
        if not np.isnan(rho):
            rhos.append(rho)
            weights.append(len(g))
    if not rhos:
        return float("nan")
    return float(np.average(rhos, weights=weights))


def _pairwise_accuracy(df: pd.DataFrame, score_col: str, truth_col: str,
                       n_pairs: int = 20000, seed: int = 7) -> float:
    """Sample random *same-author* pairs; fraction where score ordering matches
    true-likes ordering. Directly mirrors 'pick the better draft'."""
    rng = np.random.default_rng(seed)
    correct = total = 0
    for _, g in df.groupby("author"):
        if len(g) < 2:
            continue
        s = g[score_col].to_numpy()
        t = g[truth_col].to_numpy()
        k = min(n_pairs // max(df["author"].nunique(), 1) + 1, len(g) * (len(g) - 1) // 2 or 1)
        i = rng.integers(0, len(g), size=k)
        j = rng.integers(0, len(g), size=k)
        mask = t[i] != t[j]
        i, j = i[mask], j[mask]
        if len(i) == 0:
            continue
        pred = np.sign(s[i] - s[j])
        truth = np.sign(t[i] - t[j])
        correct += int((pred == truth).sum())
        total += len(i)
    return correct / total if total else float("nan")


def _precision_at_k(scores: np.ndarray, labels: np.ndarray, k: int = 10) -> float:
    order = np.argsort(-scores)
    topk = order[:k]
    return float(labels[topk].mean()) if k else float("nan")


def evaluate(df: pd.DataFrame, score_col: str = "score") -> dict:
    """df must contain: author, likes, is_viral, target, and `score_col`."""
    scores = df[score_col].to_numpy()
    likes = df["likes"].to_numpy()
    viral = df["is_viral"].to_numpy()

    overall_rho, _ = spearmanr(scores, likes)
    within_rho = _within_author_spearman(df, score_col, "likes")
    pair_acc = _pairwise_accuracy(df, score_col, "likes")

    metrics = {
        "ranking": {
            "spearman_overall": round(float(overall_rho), 4),
            "spearman_within_author": round(within_rho, 4),
            "pairwise_accuracy": round(pair_acc, 4),
        },
        "viral": {},
        "n_test": int(len(df)),
    }
    if viral.sum() > 0 and viral.sum() < len(viral):
        roc = roc_auc_score(viral, scores)
        pr = average_precision_score(viral, scores)
        # F1 at a threshold = top viral_rate fraction by score.
        thresh = np.quantile(scores, 1 - viral.mean())
        pred = (scores >= thresh).astype(int)
        f1 = f1_score(viral, pred)
        metrics["viral"] = {
            "roc_auc": round(float(roc), 4),
            "pr_auc": round(float(pr), 4),
            "f1": round(float(f1), 4),
            "precision_at_10": round(_precision_at_k(scores, viral, 10), 4),
            "base_rate": round(float(viral.mean()), 4),
        }
    return metrics


def format_comparison(results: dict[str, dict]) -> str:
    """results: {approach_name: metrics_dict} -> markdown table."""
    rows = []
    header = ("| Approach | Spearman(overall) | Spearman(within-author) | Pairwise Acc | "
              "ROC-AUC | PR-AUC | F1 | P@10 |")
    sep = "|" + "---|" * 8
    rows.append(header)
    rows.append(sep)
    for name, m in results.items():
        r, v = m.get("ranking", {}), m.get("viral", {})
        rows.append(
            f"| {name} | {r.get('spearman_overall','-')} | "
            f"{r.get('spearman_within_author','-')} | {r.get('pairwise_accuracy','-')} | "
            f"{v.get('roc_auc','-')} | {v.get('pr_auc','-')} | {v.get('f1','-')} | "
            f"{v.get('precision_at_10','-')} |"
        )
    return "\n".join(rows)
