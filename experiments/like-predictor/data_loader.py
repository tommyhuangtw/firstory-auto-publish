"""Data loading + author-baseline target + time-based split.

Shared foundation for all three approaches. The whole point of the experiment is
a *fair* comparison, so every approach trains/tests on the identical splits and
identical target produced here.
"""
from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass

import numpy as np
import pandas as pd

# Absolute paths to source data living in the main worktree (not duplicated here).
REPO_ROOT = "/Users/tommyhuang/Desktop/ai_projects/firstory-podcast-automation"
CSV_PATH = os.path.join(REPO_ROOT, "public_posts_raw_rows_threadify.csv")
DB_PATH = os.path.join(REPO_ROOT, "dashboard/data/podcast.db")

# A post is "viral" if its likes >= the author's own P90. Author-relative so a
# big account and a small account are judged on the same fairness footing.
VIRAL_PERCENTILE = 90
# Authors with fewer than this many posts have an unstable baseline; drop them.
MIN_POSTS_PER_AUTHOR = 8
TEST_FRACTION = 0.20


@dataclass
class Dataset:
    train: pd.DataFrame
    test: pd.DataFrame
    feature_note: str

    def describe(self) -> str:
        return (
            f"train={len(self.train)} test={len(self.test)} "
            f"authors_train={self.train['author'].nunique()} "
            f"viral_rate_train={self.train['is_viral'].mean():.3f} "
            f"viral_rate_test={self.test['is_viral'].mean():.3f}"
        )


def _load_csv() -> pd.DataFrame:
    df = pd.read_csv(CSV_PATH)
    out = pd.DataFrame({
        "author": df["threads_username"].astype(str),
        "text": df["content_text"].astype(str),
        "posted_at": pd.to_datetime(df["posted_at"], errors="coerce", utc=True),
        "likes": pd.to_numeric(df["like_count"], errors="coerce"),
        "has_media": df["has_media"].astype(str).str.lower().isin(["true", "1"]),
        "source": "csv",
    })
    return out


def _load_trend_posts() -> pd.DataFrame:
    """Daily hotspot crawl — extra rows with the same shape."""
    if not os.path.exists(DB_PATH):
        return pd.DataFrame()
    con = sqlite3.connect(DB_PATH)
    try:
        df = pd.read_sql_query(
            "SELECT author, text, like_count, posted_at FROM trend_posts "
            "WHERE text IS NOT NULL AND author IS NOT NULL",
            con,
        )
    finally:
        con.close()
    if df.empty:
        return df
    return pd.DataFrame({
        "author": df["author"].astype(str),
        "text": df["text"].astype(str),
        "posted_at": pd.to_datetime(df["posted_at"], errors="coerce", utc=True),
        "likes": pd.to_numeric(df["like_count"], errors="coerce"),
        "has_media": False,  # not captured in trend_posts
        "source": "trend",
    })


def load_raw(include_trend: bool = True) -> pd.DataFrame:
    frames = [_load_csv()]
    if include_trend:
        t = _load_trend_posts()
        if not t.empty:
            frames.append(t)
    df = pd.concat(frames, ignore_index=True)
    # Clean.
    df = df.dropna(subset=["likes", "posted_at"])
    df = df[df["text"].str.len() >= 2]
    df["likes"] = df["likes"].clip(lower=0)
    df = df.drop_duplicates(subset=["author", "text"]).reset_index(drop=True)
    return df


def add_author_baseline(df: pd.DataFrame) -> pd.DataFrame:
    """Compute per-author median + P90, then the author-relative target & label.

    target  = log1p(likes) - log1p(author_median)   (removes follower-count scale)
    is_viral = likes >= author P90                    (author-relative "爆")
    """
    df = df.copy()
    counts = df.groupby("author")["author"].transform("count")
    df = df[counts >= MIN_POSTS_PER_AUTHOR].reset_index(drop=True)

    grp = df.groupby("author")["likes"]
    df["author_median"] = grp.transform("median")
    df["author_p90"] = grp.transform(lambda s: np.percentile(s, VIRAL_PERCENTILE))
    df["log_likes"] = np.log1p(df["likes"])
    df["target"] = df["log_likes"] - np.log1p(df["author_median"])
    df["is_viral"] = (df["likes"] >= df["author_p90"]).astype(int)
    return df


def time_split(df: pd.DataFrame, test_fraction: float = TEST_FRACTION) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Earliest (1-frac) for train, most recent frac for test."""
    df = df.sort_values("posted_at").reset_index(drop=True)
    cut = int(len(df) * (1 - test_fraction))
    return df.iloc[:cut].copy(), df.iloc[cut:].copy()


def build_dataset(include_trend: bool = True) -> Dataset:
    raw = load_raw(include_trend=include_trend)
    enriched = add_author_baseline(raw)
    train, test = time_split(enriched)
    # Author baseline must be computed from TRAIN only to avoid leaking test
    # likes into the baseline. Recompute baselines on train, map onto test.
    train_base = train.groupby("author").agg(
        author_median=("likes", "median"),
        author_p90=("likes", lambda s: np.percentile(s, VIRAL_PERCENTILE)),
    )
    # Restrict test to authors seen in train (cold-start authors are out of scope).
    test = test[test["author"].isin(train_base.index)].copy()
    test["author_median"] = test["author"].map(train_base["author_median"])
    test["author_p90"] = test["author"].map(train_base["author_p90"])
    test["target"] = test["log_likes"] - np.log1p(test["author_median"])
    test["is_viral"] = (test["likes"] >= test["author_p90"]).astype(int)
    note = "target=log1p(likes)-log1p(author_median); viral=likes>=author_p90; baseline from TRAIN only"
    return Dataset(train=train.reset_index(drop=True), test=test.reset_index(drop=True), feature_note=note)


if __name__ == "__main__":
    ds = build_dataset()
    print(ds.describe())
    print(ds.feature_note)
    print("\ntrain sample:")
    print(ds.train[["author", "likes", "author_median", "target", "is_viral"]].head())
    print("\nsource breakdown:")
    print(ds.train["source"].value_counts())
