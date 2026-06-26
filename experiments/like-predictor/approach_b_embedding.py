"""Approach B — Semantic embeddings: multilingual sentence-transformer -> GBDT.

Captures *what the post is about* (semantics) rather than surface char n-grams.
Uses a multilingual MiniLM model that handles Chinese well. Embeddings are
cached to disk keyed by text hash so re-runs are fast.
"""
from __future__ import annotations

import hashlib
import os

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from features import structural_features

MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"
CACHE_DIR = os.path.join(os.path.dirname(__file__), "results", "emb_cache")


class EmbeddingPredictor:
    name = "B: Embedding (multilingual MiniLM + GBDT)"

    def __init__(self):
        self._model = None
        self.author_means: dict[str, float] = {}
        self.global_mean = 0.0
        self.model = HistGradientBoostingRegressor(
            max_iter=400, learning_rate=0.05, l2_regularization=1.0, random_state=7
        )
        self.struct_cols: list[str] = []

    def _lazy_model(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer(MODEL_NAME)
        return self._model

    def _embed(self, texts: list[str]) -> np.ndarray:
        os.makedirs(CACHE_DIR, exist_ok=True)
        key = hashlib.md5(("||".join(texts)).encode()).hexdigest()
        path = os.path.join(CACHE_DIR, f"{key}.npy")
        if os.path.exists(path):
            return np.load(path)
        emb = self._lazy_model().encode(
            texts, batch_size=64, show_progress_bar=True, normalize_embeddings=True
        )
        np.save(path, emb)
        return emb

    def _matrix(self, df: pd.DataFrame, fit: bool) -> np.ndarray:
        emb = self._embed(df["text"].astype(str).tolist())
        struct = structural_features(df)
        if fit:
            self.struct_cols = list(struct.columns)
        struct = struct[self.struct_cols].to_numpy(dtype=float)
        author = df["author"].map(self.author_means).fillna(self.global_mean).to_numpy().reshape(-1, 1)
        return np.hstack([emb, struct, author]).astype(np.float32)

    def train(self, train: pd.DataFrame) -> None:
        self.global_mean = float(train["target"].mean())
        self.author_means = train.groupby("author")["target"].mean().to_dict()
        X = self._matrix(train, fit=True)
        self.model.fit(X, train["target"].to_numpy())

    def predict(self, test: pd.DataFrame) -> np.ndarray:
        X = self._matrix(test, fit=False)
        return self.model.predict(X)
