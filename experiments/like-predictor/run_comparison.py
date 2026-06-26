"""Run all three approaches on identical splits and emit a comparison report.

Usage:
    python3 run_comparison.py            # A + B on full test; C on sample
    python3 run_comparison.py --no-llm   # skip approach C (no API calls)
    python3 run_comparison.py --llm-sample 150
"""
from __future__ import annotations

import argparse
import json
import os
import time

import numpy as np
import pandas as pd

from data_loader import build_dataset
from eval import evaluate, format_comparison

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")


def _stratified_sample(test: pd.DataFrame, n: int, seed: int = 7) -> pd.DataFrame:
    """Sample n rows preserving viral/non-viral ratio."""
    if n >= len(test):
        return test
    viral = test[test["is_viral"] == 1]
    non = test[test["is_viral"] == 0]
    n_viral = max(1, int(round(n * test["is_viral"].mean())))
    n_non = n - n_viral
    rng = np.random.RandomState(seed)
    parts = [
        viral.sample(min(n_viral, len(viral)), random_state=rng),
        non.sample(min(n_non, len(non)), random_state=rng),
    ]
    return pd.concat(parts).sample(frac=1, random_state=rng).reset_index(drop=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-llm", action="store_true")
    ap.add_argument("--llm-sample", type=int, default=200)
    args = ap.parse_args()

    os.makedirs(RESULTS_DIR, exist_ok=True)
    ds = build_dataset()
    print(">> dataset:", ds.describe())
    print(">>", ds.feature_note)

    results: dict[str, dict] = {}

    # --- Approach A ---
    from approach_a_classical import ClassicalPredictor
    t0 = time.time()
    a = ClassicalPredictor()
    a.train(ds.train)
    test_a = ds.test.copy()
    test_a["score"] = a.predict(ds.test)
    results[a.name] = evaluate(test_a)
    print(f"\n[A] done in {time.time()-t0:.1f}s")
    print(json.dumps(results[a.name], indent=2, ensure_ascii=False))

    # --- Approach B ---
    from approach_b_embedding import EmbeddingPredictor
    t0 = time.time()
    b = EmbeddingPredictor()
    b.train(ds.train)
    test_b = ds.test.copy()
    test_b["score"] = b.predict(ds.test)
    results[b.name] = evaluate(test_b)
    print(f"\n[B] done in {time.time()-t0:.1f}s")
    print(json.dumps(results[b.name], indent=2, ensure_ascii=False))

    # --- Approach C (on a sample; re-eval A & B on same sample) ---
    if not args.no_llm:
        from approach_c_llm import LLMPredictor
        sample = _stratified_sample(ds.test, args.llm_sample)
        t0 = time.time()
        c = LLMPredictor()
        c.train(ds.train)
        s = sample.copy()
        s["score"] = c.predict(sample)
        results[c.name] = evaluate(s)
        print(f"\n[C] done in {time.time()-t0:.1f}s on {len(sample)} sampled posts")
        print(json.dumps(results[c.name], indent=2, ensure_ascii=False))

        # Apples-to-apples: A & B on the identical sample.
        sa = sample.copy(); sa["score"] = a.predict(sample)
        sb = sample.copy(); sb["score"] = b.predict(sample)
        results[f"(sample) {a.name}"] = evaluate(sa)
        results[f"(sample) {b.name}"] = evaluate(sb)

    # --- Report ---
    table = format_comparison(results)
    report = (
        f"# Like Predictor — Comparison Report\n\n"
        f"Dataset: {ds.describe()}\n\n"
        f"Target: {ds.feature_note}\n\n"
        f"## Full test set (A & B)\n\n{table}\n\n"
        f"Headline metric = **Spearman(within-author)**: can the model rank a "
        f"single account's own posts by engagement (i.e. pick the better draft).\n"
    )
    with open(os.path.join(RESULTS_DIR, "comparison.md"), "w") as fh:
        fh.write(report)
    with open(os.path.join(RESULTS_DIR, "metrics.json"), "w") as fh:
        json.dump(results, fh, indent=2, ensure_ascii=False)

    print("\n" + "=" * 70)
    print(table)
    print("\nSaved -> results/comparison.md, results/metrics.json")


if __name__ == "__main__":
    main()
