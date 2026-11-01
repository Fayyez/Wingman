"""Deterministic texting-style features (docs/03 §8.1). M1 computes them from the user's
outgoing messages in the request window; M2 replaces this with stored style profiles."""

from __future__ import annotations

import re
from statistics import mean
from typing import Any

_LAUGH = re.compile(r"\b(ha(ha)+h?|he(he)+|lol+|lmao|xd)\b", re.I)
_EMOJI = re.compile("[\U0001f300-\U0001faff☀-➿]")


def style_features(samples: list[str]) -> dict[str, Any]:
    samples = [s for s in samples if s.strip()]
    if not samples:
        return {}
    words = [len(s.split()) for s in samples]
    letters = [c for s in samples for c in s if c.isalpha()]
    emojis = [e for s in samples for e in _EMOJI.findall(s)]
    n = len(samples)
    return {
        "avg_words": round(mean(words), 1),
        "max_words": max(words),
        "lowercase_ratio": round(sum(c.islower() for c in letters) / max(len(letters), 1), 2),
        "starts_with_capital_ratio": round(sum(1 for s in samples if s[:1].isupper()) / n, 2),
        "ends_with_punctuation_ratio": round(
            sum(1 for s in samples if s.rstrip()[-1:] in ".!") / n, 2
        ),
        "emoji_per_message": round(len(emojis) / n, 2),
        "favourite_emojis": sorted(set(emojis), key=emojis.count, reverse=True)[:4],
        "laugh_tokens": sorted({m.group(0).lower() for s in samples for m in _LAUGH.finditer(s)})[
            :4
        ],
    }
