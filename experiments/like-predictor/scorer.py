"""Load the shipped model bundle and score fresh drafts.

Primary gauge = viral_prob (P the post beats the author's own P90 = "會不會爆").
relative_score is the finer-grained ranking signal (tiebreaker / ordering).
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import joblib
import pandas as pd

MODEL_PATH = os.path.join(os.path.dirname(__file__), "model", "bundle.joblib")

_BUNDLE = None


def _bundle():
    global _BUNDLE
    if _BUNDLE is None:
        _BUNDLE = joblib.load(MODEL_PATH)
    return _BUNDLE


def score_one(text: str, author: str | None = None) -> dict:
    return score_many([text], author)[0]


def score_many(texts: list[str], author: str | None = None) -> list[dict]:
    b = _bundle()
    author = author or b.default_author
    now = pd.Timestamp(datetime.now(timezone.utc))
    df = pd.DataFrame({
        "text": [str(t) for t in texts],
        "author": author,
        "posted_at": now,
        "has_media": False,
        "likes": 0,  # unused at inference; present so feature code is uniform
    })
    scored = b.score_frame(df)
    base = b.author_baselines.get(author, {})
    out = []
    for _, r in scored.iterrows():
        out.append({
            "viral_prob": round(float(r["viral_prob"]), 4),
            "relative_score": round(float(r["relative_score"]), 4),
            "author": author,
            "author_median_likes": base.get("median_likes"),
            "author_p90_likes": base.get("p90_likes"),
        })
    return out


if __name__ == "__main__":
    samples = [
        "今天想跟大家分享一個很有用的 AI 工具，希望對你有幫助。",
        "我把每天 3 小時的剪輯工作,用一個 AI 工具壓到 20 分鐘。\n\n方法很簡單,但沒人告訴你的是這一步...",
        "你知道嗎?90% 的人用 ChatGPT 的方式都錯了。",
    ]
    for s in score_many(samples):
        print(f"viral={s['viral_prob']:.2%}  rel={s['relative_score']:+.3f}  | {s}")
