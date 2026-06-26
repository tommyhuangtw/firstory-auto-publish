"""Approach A — Classical ML: TF-IDF + structural + author features -> GBDT.

Predicts the author-relative target. Fast, interpretable, strong baseline.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, hstack
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import StandardScaler

from features import structural_features


class ClassicalPredictor:
    name = "A: Classical (TF-IDF + GBDT)"

    def __init__(self):
        # char_wb works well for Chinese (no whitespace tokenization needed).
        self.tfidf = TfidfVectorizer(
            analyzer="char_wb", ngram_range=(2, 4), min_df=5, max_features=8000
        )
        self.scaler = StandardScaler()
        self.author_means: dict[str, float] = {}
        self.global_mean = 0.0
        self.model = HistGradientBoostingRegressor(
            max_iter=400, learning_rate=0.05, max_depth=None,
            l2_regularization=1.0, random_state=7,
        )
        self.struct_cols: list[str] = []

    def _author_feat(self, df: pd.DataFrame) -> np.ndarray:
        # Author's historical mean target (from train); unseen -> global mean.
        return df["author"].map(self.author_means).fillna(self.global_mean).to_numpy().reshape(-1, 1)

    def _matrix(self, df: pd.DataFrame, fit: bool):
        struct = structural_features(df)
        if fit:
            self.struct_cols = list(struct.columns)
        struct = struct[self.struct_cols].to_numpy(dtype=float)
        if fit:
            tf = self.tfidf.fit_transform(df["text"].astype(str))
            struct = self.scaler.fit_transform(struct)
        else:
            tf = self.tfidf.transform(df["text"].astype(str))
            struct = self.scaler.transform(struct)
        author = self._author_feat(df)
        return hstack([tf, csr_matrix(struct), csr_matrix(author)]).tocsr()

    def train(self, train: pd.DataFrame) -> None:
        self.global_mean = float(train["target"].mean())
        self.author_means = train.groupby("author")["target"].mean().to_dict()
        X = self._matrix(train, fit=True)
        # HistGBDT needs dense; downcast for memory.
        self.model.fit(X.toarray().astype(np.float32), train["target"].to_numpy())

    def predict(self, test: pd.DataFrame) -> np.ndarray:
        X = self._matrix(test, fit=False)
        return self.model.predict(X.toarray().astype(np.float32))
