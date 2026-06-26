"""Approach C — LLM scoring via OpenRouter (few-shot, no training).

Asks an LLM to rate a post's engagement potential 0-100, *relative to a typical
post* (so it's author-scale agnostic, matching our target). Few-shot examples are
drawn from the training set. Scored concurrently; results cached to disk.

LLM scoring every test row is expensive, so the comparison runner evaluates this
approach on a stratified SAMPLE of the test set (A & B are re-scored on the same
sample for an apples-to-apples row in the table).
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import os
import re

import numpy as np
import pandas as pd
import requests

REPO_ROOT = "/Users/tommyhuang/Desktop/ai_projects/firstory-podcast-automation"
CACHE_PATH = os.path.join(os.path.dirname(__file__), "results", "llm_scores.json")
MODEL = os.environ.get("LIKE_PREDICTOR_LLM_MODEL", "openai/gpt-4o-mini")
ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"


def _load_key() -> str:
    key = os.environ.get("OPENROUTER_API_KEY")
    if key:
        return key
    env_path = os.path.join(REPO_ROOT, "dashboard/.env.local")
    with open(env_path) as fh:
        for line in fh:
            if line.startswith("OPENROUTER_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("OPENROUTER_API_KEY not found")


SYSTEM = (
    "你是社群媒體成效分析師，專精 Threads 中文貼文。"
    "你的工作是評估一篇貼文的『互動潛力』——相對於同一帳號的普通貼文，"
    "這篇會不會表現得特別好。只看內容本身（鉤子、情緒、實用性、可分享性、爭議性），"
    "不要考慮帳號粉絲數。輸出 0-100 的整數分數，100=極可能爆紅、50=普通、0=極差。"
    "只回一個數字，不要任何其他文字。"
)


def _build_fewshot(train: pd.DataFrame, n: int = 6) -> list[dict]:
    """Pick high- and low-relative-engagement examples as few-shot anchors."""
    hi = train.nlargest(n // 2, "target")
    lo = train.nsmallest(n // 2, "target")
    msgs = []
    for _, r in pd.concat([hi, lo]).iterrows():
        score = int(np.clip(50 + r["target"] * 25, 0, 100))
        msgs.append({"role": "user", "content": f"貼文：\n{r['text'][:600]}"})
        msgs.append({"role": "assistant", "content": str(score)})
    return msgs


class LLMPredictor:
    name = "C: LLM (OpenRouter few-shot)"

    def __init__(self, max_workers: int = 8):
        self.key = _load_key()
        self.fewshot: list[dict] = []
        self.max_workers = max_workers
        self._cache = self._load_cache()

    def _load_cache(self) -> dict:
        if os.path.exists(CACHE_PATH):
            with open(CACHE_PATH) as fh:
                return json.load(fh)
        return {}

    def _save_cache(self) -> None:
        os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
        with open(CACHE_PATH, "w") as fh:
            json.dump(self._cache, fh)

    def train(self, train: pd.DataFrame) -> None:
        self.fewshot = _build_fewshot(train)

    def _score_one(self, text: str) -> float:
        ck = f"{MODEL}|{hash(text)}"
        if ck in self._cache:
            return self._cache[ck]
        messages = [{"role": "system", "content": SYSTEM}, *self.fewshot,
                    {"role": "user", "content": f"貼文：\n{text[:600]}"}]
        try:
            resp = requests.post(
                ENDPOINT,
                headers={"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"},
                json={"model": MODEL, "messages": messages, "temperature": 0, "max_tokens": 6},
                timeout=40,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
            m = re.search(r"\d+", content)
            val = float(m.group()) if m else 50.0
        except Exception:
            val = 50.0  # neutral fallback on error
        self._cache[ck] = val
        return val

    def predict(self, test: pd.DataFrame) -> np.ndarray:
        texts = test["text"].astype(str).tolist()
        scores = [None] * len(texts)
        with cf.ThreadPoolExecutor(max_workers=self.max_workers) as ex:
            futures = {ex.submit(self._score_one, t): i for i, t in enumerate(texts)}
            for fut in cf.as_completed(futures):
                scores[futures[fut]] = fut.result()
        self._save_cache()
        return np.array(scores, dtype=float)
