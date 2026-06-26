"""Shared model core for the production tool (winner = Approach A).

Two heads on the same features:
  - regressor  -> relative_score  (author-relative engagement, for ranking)
  - classifier -> viral_prob       (P(likes >= author P90), the "會不會爆" gauge)

`FeaturePipe` builds the design matrix; `ModelBundle` holds everything needed to
score a fresh draft and is what gets persisted to disk.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, hstack
from sklearn.ensemble import (
    HistGradientBoostingClassifier,
    HistGradientBoostingRegressor,
)
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import StandardScaler

from features import structural_features


class FeaturePipe:
    """TF-IDF (char n-gram) + structural features + author historical mean."""

    def __init__(self):
        self.tfidf = TfidfVectorizer(
            analyzer="char_wb", ngram_range=(2, 4), min_df=5, max_features=8000
        )
        self.scaler = StandardScaler()
        self.struct_cols: list[str] = []
        self.author_means: dict[str, float] = {}
        self.global_mean = 0.0

    def fit(self, df: pd.DataFrame) -> "FeaturePipe":
        self.global_mean = float(df["target"].mean())
        self.author_means = df.groupby("author")["target"].mean().to_dict()
        struct = structural_features(df)
        self.struct_cols = list(struct.columns)
        self.tfidf.fit(df["text"].astype(str))
        self.scaler.fit(struct[self.struct_cols].to_numpy(dtype=float))
        return self

    def transform(self, df: pd.DataFrame) -> csr_matrix:
        struct = structural_features(df)[self.struct_cols].to_numpy(dtype=float)
        struct = self.scaler.transform(struct)
        tf = self.tfidf.transform(df["text"].astype(str))
        author = (
            df["author"].map(self.author_means).fillna(self.global_mean)
            .to_numpy().reshape(-1, 1)
        )
        return hstack([tf, csr_matrix(struct), csr_matrix(author)]).tocsr()


@dataclass
class ModelBundle:
    pipe: FeaturePipe
    regressor: HistGradientBoostingRegressor
    classifier: HistGradientBoostingClassifier
    # Per-author baseline for context (median/p90 likes), from training data.
    author_baselines: dict[str, dict] = field(default_factory=dict)
    default_author: str = ""
    meta: dict = field(default_factory=dict)

    def score_frame(self, df: pd.DataFrame) -> pd.DataFrame:
        X = self.pipe.transform(df).toarray().astype(np.float32)
        rel = self.regressor.predict(X)
        prob = self.classifier.predict_proba(X)[:, 1]
        out = df.copy()
        out["relative_score"] = rel
        out["viral_prob"] = prob
        return out


def train_bundle(train: pd.DataFrame, default_author: str, meta: dict) -> ModelBundle:
    pipe = FeaturePipe().fit(train)
    X = pipe.transform(train).toarray().astype(np.float32)
    reg = HistGradientBoostingRegressor(
        max_iter=400, learning_rate=0.05, l2_regularization=1.0, random_state=7
    ).fit(X, train["target"].to_numpy())
    clf = HistGradientBoostingClassifier(
        max_iter=400, learning_rate=0.05, l2_regularization=1.0, random_state=7
    ).fit(X, train["is_viral"].to_numpy())

    baselines = {}
    for author, g in train.groupby("author"):
        baselines[author] = {
            "median_likes": float(np.median(g["likes"])),
            "p90_likes": float(np.percentile(g["likes"], 90)),
            "n_posts": int(len(g)),
        }
    return ModelBundle(
        pipe=pipe, regressor=reg, classifier=clf,
        author_baselines=baselines, default_author=default_author, meta=meta,
    )
