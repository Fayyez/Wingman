"""Deterministic clean-up of generated cards. M1: universal anti-AI-tells only. M2 adds the
per-user style post-processor (docs/03 §8.4)."""

from __future__ import annotations

import re

_EM_DASH = re.compile(r"\s*[—–]\s*")
_SEMICOLON = re.compile(r"\s*;\s*")
_WS = re.compile(r"[ \t]+")
_OPENERS = re.compile(r"^(hey there[!,.]?\s*|absolutely[!,.]?\s*|certainly[!,.]?\s*)", re.I)


def scrub_ai_tells(text: str) -> str:
    t = _EM_DASH.sub(", ", text)
    t = _SEMICOLON.sub(", ", t)
    t = _OPENERS.sub("", t)
    t = "\n".join(_WS.sub(" ", line).strip() for line in t.split("\n"))
    return t.strip()


def normalized(text: str) -> str:
    """Key for de-duplication: lowercase, letters/digits only."""
    return re.sub(r"[^\w]+", " ", text.lower()).strip()
