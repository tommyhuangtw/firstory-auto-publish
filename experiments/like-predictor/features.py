"""Hand-crafted structural features for Approach A.

Content/format signals that plausibly drive engagement on Threads, independent
of follower count. Author identity is added separately (one-hot) by the model.
"""
from __future__ import annotations

import re

import numpy as np
import pandas as pd

_EMOJI = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF]"
)
_URL = re.compile(r"https?://\S+")
_HASHTAG = re.compile(r"#\S+")
_CJK = re.compile(r"[一-鿿]")


def structural_features(df: pd.DataFrame) -> pd.DataFrame:
    text = df["text"].astype(str)
    pa = pd.to_datetime(df["posted_at"], utc=True, errors="coerce")
    f = pd.DataFrame(index=df.index)

    f["char_len"] = text.str.len()
    f["log_char_len"] = np.log1p(f["char_len"])
    f["line_count"] = text.str.count("\n") + 1
    f["word_count"] = text.str.split().apply(len)
    f["cjk_count"] = text.apply(lambda s: len(_CJK.findall(s)))
    f["emoji_count"] = text.apply(lambda s: len(_EMOJI.findall(s)))
    f["has_emoji"] = (f["emoji_count"] > 0).astype(int)
    f["question_count"] = text.str.count(r"[?？]")
    f["exclaim_count"] = text.str.count(r"[!！]")
    f["has_question"] = (f["question_count"] > 0).astype(int)
    f["digit_count"] = text.str.count(r"\d")
    f["has_number"] = (f["digit_count"] > 0).astype(int)
    f["url_count"] = text.apply(lambda s: len(_URL.findall(s)))
    f["hashtag_count"] = text.apply(lambda s: len(_HASHTAG.findall(s)))
    f["has_media"] = df.get("has_media", pd.Series(False, index=df.index)).astype(int)

    # Opening hook: first line length + whether it ends with a colon/question.
    first_line = text.str.split("\n").str[0]
    f["hook_len"] = first_line.str.len()
    f["hook_is_question"] = first_line.str.contains(r"[?？]", regex=True, na=False).astype(int)

    # Posting time signals (engagement varies by hour/day).
    f["hour"] = pa.dt.hour.fillna(12).astype(int)
    f["dayofweek"] = pa.dt.dayofweek.fillna(0).astype(int)
    f["is_weekend"] = (f["dayofweek"] >= 5).astype(int)
    # Cyclical encoding of hour.
    f["hour_sin"] = np.sin(2 * np.pi * f["hour"] / 24)
    f["hour_cos"] = np.cos(2 * np.pi * f["hour"] / 24)

    return f.fillna(0)


FEATURE_COLUMNS = None  # set on first call for stable column order
