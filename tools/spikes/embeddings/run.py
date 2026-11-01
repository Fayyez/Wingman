#!/usr/bin/env python3
"""M0-05 embedding bake-off: retrieval quality on code-mixed Roman Urdu/Hindi + English.

Usage: uv run --project services/api python tools/spikes/embeddings/run.py --provider fake
"""
from __future__ import annotations

import argparse
import hashlib
import math
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import yaml

HERE = Path(__file__).resolve().parent
PAIRS = HERE.parents[2] / "data" / "eval" / "embeddings" / "pairs.yaml"
OUT = HERE / "out" / "results.md"
BATCH = 32
GROUPS = ("pk", "in", "en")

# Tiny canonicalization map (spelling variant -> canonical), applied per word.
VARIANTS: dict[str, str] = {
    "kia": "kya", "kiya": "kya", "kyaa": "kya", "hy": "hai", "hay": "hai", "h": "hai",
    "ni": "nahi", "nai": "nahi", "nhi": "nahi", "nahin": "nahi", "nae": "nahi",
    "yr": "yaar", "yar": "yaar", "yaa": "yaar", "bht": "bohat", "bohot": "bohat", "bahut": "bohat",
    "acha": "accha", "achaa": "accha", "achha": "accha", "acchi": "achi",
    "kr": "kar", "krna": "karna", "krni": "karni", "rhy": "rahe", "rha": "raha", "rhi": "rahi",
    "mjhe": "mujhe", "mje": "mujhe", "mene": "maine", "tm": "tum", "tu": "tum", "wese": "waise",
    "plz": "please", "pls": "please", "sry": "sorry", "gud": "good", "nyt": "night", "gn": "good night",
    "kyu": "kyun", "q": "kyun", "thk": "theek", "thik": "theek", "sath": "saath", "sb": "sab",
    "aj": "aaj", "pta": "pata", "msg": "message", "bura": "bura", "ghalti": "galti", "k": "ke",
}

Embedder = Callable[[list[str]], list[list[float]]]


def normalize_text(text: str) -> str:
    words = re.findall(r"\w+|[^\w\s]", text.lower())
    return " ".join(VARIANTS.get(w, w) for w in words)


def make_fake(_: argparse.Namespace) -> Embedder:
    """Hashed character-trigram bag-of-words (lexical baseline, no deps)."""
    dim = 1024

    def embed(texts: list[str]) -> list[list[float]]:
        out = []
        for t in texts:
            v = [0.0] * dim
            for w in re.findall(r"\w+", t.lower()):
                p = f"^{w}$"
                for i in range(max(1, len(p) - 2)):
                    h = int(hashlib.md5(p[i : i + 3].encode()).hexdigest()[:8], 16)
                    v[h % dim] += 1.0
            out.append(v)
        return out

    return embed


def make_bge_m3(_: argparse.Namespace) -> Embedder:
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        sys.exit("bge-m3 needs sentence-transformers: uv pip install sentence-transformers")
    model = SentenceTransformer("BAAI/bge-m3")
    return lambda texts: model.encode(texts, normalize_embeddings=True).tolist()


def make_openai(args: argparse.Namespace) -> Embedder:
    try:
        from openai import OpenAI
    except ImportError:
        sys.exit("openai provider needs the SDK: uv pip install openai")
    if not os.environ.get("OPENAI_API_KEY"):
        sys.exit("openai provider needs OPENAI_API_KEY in the environment")
    client = OpenAI()
    return lambda texts: [d.embedding for d in client.embeddings.create(model=args.model, input=texts).data]


def make_voyage(args: argparse.Namespace) -> Embedder:
    try:
        import voyageai
    except ImportError:
        sys.exit("voyage provider needs the SDK: uv pip install voyageai")
    if not os.environ.get("VOYAGE_API_KEY"):
        sys.exit("voyage provider needs VOYAGE_API_KEY in the environment")
    client = voyageai.Client()
    return lambda texts: client.embed(texts, model=args.model).embeddings


PROVIDERS: dict[str, tuple[Callable[[argparse.Namespace], Embedder], str]] = {
    "fake": (make_fake, "trigram-hash"),
    "bge-m3": (make_bge_m3, "BAAI/bge-m3"),
    "openai": (make_openai, "text-embedding-3-small"),
    "voyage": (make_voyage, "voyage-multilingual-2"),
}


def unit(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def embed_all(embed: Embedder, texts: list[str], lat: list[float]) -> list[list[float]]:
    out: list[list[float]] = []
    for i in range(0, len(texts), BATCH):
        t0 = time.perf_counter()
        out.extend(embed(texts[i : i + BATCH]))
        lat.append(time.perf_counter() - t0)
    return [unit(v) for v in out]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--provider", required=True, choices=sorted(PROVIDERS))
    ap.add_argument("--model", help="model name (openai/voyage)")
    ap.add_argument("--normalize-spelling", action="store_true", help="canonicalize spelling variants first")
    ap.add_argument("--pairs", type=Path, default=PAIRS)
    args = ap.parse_args()
    factory, default_model = PROVIDERS[args.provider]
    args.model = args.model or default_model

    items = yaml.safe_load(args.pairs.read_text(encoding="utf-8"))["items"]
    prep = normalize_text if args.normalize_spelling else (lambda s: s)
    corpus: list[str] = []
    index: dict[str, int] = {}
    for it in items:
        for s in [it["positive"], *it["negatives"]]:
            key = prep(s)
            if key not in index:
                index[key] = len(corpus)
                corpus.append(key)

    embed = factory(args)
    lat: list[float] = []
    cvecs = embed_all(embed, corpus, lat)
    qvecs = embed_all(embed, [prep(it["query"]) for it in items], lat)

    ranks: dict[str, list[int]] = {g: [] for g in GROUPS}
    for it, q in zip(items, qvecs):
        scores = [sum(a * b for a, b in zip(q, c)) for c in cvecs]
        pos = scores[index[prep(it["positive"])]]
        ranks[it["id"].split("-")[0]].append(1 + sum(s > pos for s in scores))
    ranks["all"] = [r for g in GROUPS for r in ranks[g]]

    def metrics(rs: list[int]) -> tuple[float, float, float]:
        n = len(rs)
        return sum(r <= 1 for r in rs) / n, sum(r <= 5 for r in rs) / n, sum(1 / r for r in rs) / n

    label = f"{args.provider}:{args.model}" + (" +norm" if args.normalize_spelling else "")
    avg_ms = 1000 * sum(lat) / len(lat)
    lines = [
        f"### {label}  ({datetime.now(timezone.utc):%Y-%m-%d %H:%M}Z, corpus={len(corpus)}, queries={len(items)})",
        "",
        "| group | n | Recall@1 | Recall@5 | MRR |",
        "|---|---|---|---|---|",
    ]
    for g in ("all", *GROUPS):
        r1, r5, mrr = metrics(ranks[g])
        lines.append(f"| {g} | {len(ranks[g])} | {r1:.3f} | {r5:.3f} | {mrr:.3f} |")
    pi = ranks["pk"] + ranks["in"]
    _, r5, _ = metrics(pi)
    lines += ["", f"pk+in Recall@5: {r5:.3f} | avg latency/batch (<= {BATCH}): {avg_ms:.1f} ms over {len(lat)} batches", ""]
    text = "\n".join(lines)
    print(text)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("a", encoding="utf-8") as f:
        f.write(text + "\n")


if __name__ == "__main__":
    main()
