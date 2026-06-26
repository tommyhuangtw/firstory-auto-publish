"""Train the production model bundle (personalized: includes Tommy's own posts).

Trains on a time-split train fold, evaluates on the held-out fold (so the saved
numbers are honest), then RETRAINS on all data for the shipped artifact.

Usage:
    python3 train_model.py            # train, eval, save -> model/bundle.joblib
"""
from __future__ import annotations

import json
import os

import joblib
import numpy as np
import pandas as pd

from data_loader import (
    PERSONAL_AUTHOR, add_author_baseline, build_dataset, load_raw, time_split,
)
from eval import evaluate
from model_core import train_bundle

MODEL_DIR = os.path.join(os.path.dirname(__file__), "model")


def _personal_report(bundle, df_personal_test: pd.DataFrame) -> dict:
    """How well does it rank/flag Tommy's OWN held-out posts?"""
    if len(df_personal_test) < 10:
        return {"note": "too few personal test posts", "n": int(len(df_personal_test))}
    scored = bundle.score_frame(df_personal_test)
    scored["score"] = scored["viral_prob"]
    return evaluate(scored)


def main():
    os.makedirs(MODEL_DIR, exist_ok=True)

    # --- Honest eval on a held-out fold (personalized data) ---
    ds = build_dataset(include_trend=True, include_personal=True)
    print(">> dataset:", ds.describe())
    bundle_eval = train_bundle(
        ds.train, default_author=PERSONAL_AUTHOR,
        meta={"phase": "eval", "feature_note": ds.feature_note},
    )
    scored = bundle_eval.score_frame(ds.test)

    # Rank by viral_prob (primary use case = 會不會爆), then relative_score.
    rep_viral = evaluate(scored.assign(score=scored["viral_prob"]))
    rep_rank = evaluate(scored.assign(score=scored["relative_score"]))

    personal_test = ds.test[ds.test["author"] == PERSONAL_AUTHOR]
    rep_personal = _personal_report(bundle_eval, personal_test)

    report = {
        "dataset": ds.describe(),
        "eval_by_viral_prob": rep_viral,
        "eval_by_relative_score": rep_rank,
        "personal_only (author=%s, n=%d)" % (PERSONAL_AUTHOR, len(personal_test)): rep_personal,
    }
    print(json.dumps(report, indent=2, ensure_ascii=False))

    # --- Ship: retrain on ALL data (train+test) for the live artifact ---
    raw = load_raw(include_trend=True, include_personal=True)
    full = add_author_baseline(raw).sort_values("posted_at").reset_index(drop=True)
    bundle = train_bundle(
        full, default_author=PERSONAL_AUTHOR,
        meta={
            "phase": "ship", "feature_note": ds.feature_note,
            "trained_on_rows": int(len(full)),
            "eval": report,
        },
    )
    joblib.dump(bundle, os.path.join(MODEL_DIR, "bundle.joblib"))
    with open(os.path.join(MODEL_DIR, "train_report.json"), "w") as fh:
        json.dump(report, fh, indent=2, ensure_ascii=False)

    pb = bundle.author_baselines.get(PERSONAL_AUTHOR, {})
    print(f"\n>> saved model/bundle.joblib ({len(full)} rows)")
    print(f">> personal baseline ({PERSONAL_AUTHOR}): {pb}")


if __name__ == "__main__":
    main()
