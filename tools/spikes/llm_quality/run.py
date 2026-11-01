# /// script
# requires-python = ">=3.12"
# dependencies = ["anthropic>=2.3", "openai>=3.42", "pydantic>=2.8", "pyyaml>=6"]
# ///
"""M0-04 LLM quality spike: run the 30 scenarios against several provider/model targets,
score deterministically, and produce a BLIND rating sheet for native-speaker review.

Usage (from repo root):
  uv run tools/spikes/llm_quality/run.py run --targets fake            # dry run, no keys
  uv run tools/spikes/llm_quality/run.py run \
      --targets anthropic:claude-opus-5-5:low,anthropic:claude-sonnet-5-5:low,anthropic:claude-haiku-5-5:low
  uv run tools/spikes/llm_quality/run.py summarize --run tools/spikes/llm_quality/out/<stamp>

Target syntax: provider:model[:effort]. Providers: anthropic, openai, fake.
Keys: ANTHROPIC_API_KEY / OPENAI_API_KEY (env or repo .env). Outputs go to out/<stamp>/ (gitignored).
"""

from __future__ import annotations

import argparse
import csv
import itertools
import json
import os
import random
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from statistics import mean
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, ValidationError

sys.path.insert(0, str(Path(__file__).parent))
from prompt_v0 import OUTPUT_SCHEMA, SYSTEM_CORE, chat_block, style_block, style_features, turn_block  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
SCENARIOS = ROOT / "data/eval/spike/scenarios.yaml"
OUT = Path(__file__).parent / "out"

# USD per 1M tokens: (input, output, cache_read). Claude list prices as of 2026-10; verify before budgeting.
PRICES: dict[str, tuple[float, float, float]] = {
    "claude-opus-5-5": (4.0, 20.0, 0.20),
    "claude-sonnet-5-5": (2.0, 10.0, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.01),
}
# Models that accept the server-side refusal fallback (Claude API).
FALLBACK_OK = {"claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1"}


# ---------- output validation ----------
class Analysis(BaseModel):
    their_mood: str
    energy: Literal["low", "medium", "high"]
    interest: Literal["low", "medium", "high", "unclear"]
    hooks: list[str]
    recommended_move: str
    boundary_signal: bool
    minor_signal: bool


class Card(BaseModel):
    kind: Literal["reply", "topic"]
    approach: str
    text: str = Field(min_length=1)
    why: str


class SuggestOutput(BaseModel):
    analysis: Analysis
    cards: list[Card] = Field(max_length=3)
    guide: str | None
    memory_facts: list[str]


@dataclass
class Result:
    scenario_id: str
    target: str
    ok: bool
    output: dict[str, Any] | None
    error: str | None
    latency_s: float
    usage: dict[str, int] = field(default_factory=dict)
    cost_usd: float | None = None
    stop_reason: str | None = None


# ---------- providers ----------
def load_env() -> None:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                if v.strip():
                    os.environ.setdefault(k.strip(), v.strip())


def call_anthropic(model: str, effort: str | None, scn: dict[str, Any]) -> tuple[str, dict[str, int], str | None]:
    import anthropic

    client = anthropic.Anthropic()
    kwargs: dict[str, Any] = {}
    if model in FALLBACK_OK:
        kwargs |= {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
    output_config: dict[str, Any] = {"format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}}
    if effort:
        output_config["effort"] = effort
    resp = client.beta.messages.create(
        model=model,
        max_tokens=8000,
        # L1 + L2 are stable across a user's requests -> cache breakpoints after each.
        system=[
            {"type": "text", "text": SYSTEM_CORE, "cache_control": {"type": "ephemeral"}},
            {"type": "text", "text": style_block(scn), "cache_control": {"type": "ephemeral"}},
        ],
        messages=[{"role": "user", "content": chat_block(scn) + "\n\n" + turn_block(scn)}],
        output_config=output_config,
        **kwargs,
    )
    u = resp.usage
    usage = {
        "input": u.input_tokens or 0,
        "output": u.output_tokens or 0,
        "cache_read": getattr(u, "cache_read_input_tokens", 0) or 0,
        "cache_write": getattr(u, "cache_creation_input_tokens", 0) or 0,
    }
    if resp.stop_reason == "refusal":
        cat = getattr(getattr(resp, "stop_details", None), "category", None)
        raise RuntimeError(f"refusal (category={cat})")
    text = next((b.text for b in resp.content if b.type == "text"), "")
    return text, usage, resp.stop_reason


def call_openai(model: str, effort: str | None, scn: dict[str, Any]) -> tuple[str, dict[str, int], str | None]:
    import openai

    client = openai.OpenAI()
    kwargs: dict[str, Any] = {"reasoning_effort": effort} if effort else {}
    resp = client.chat.completions.create(
        model=model,
        max_completion_tokens=8000,
        messages=[
            {"role": "system", "content": SYSTEM_CORE + "\n\n" + style_block(scn)},
            {"role": "user", "content": chat_block(scn) + "\n\n" + turn_block(scn)},
        ],
        response_format={"type": "json_schema", "json_schema": {"name": "suggest_output", "strict": True, "schema": OUTPUT_SCHEMA}},
        **kwargs,
    )
    choice = resp.choices[0]
    if getattr(choice.message, "refusal", None):
        raise RuntimeError(f"refusal: {choice.message.refusal}")
    u = resp.usage
    cached = getattr(getattr(u, "prompt_tokens_details", None), "cached_tokens", 0) or 0
    usage = {"input": (u.prompt_tokens or 0) - cached, "output": u.completion_tokens or 0, "cache_read": cached, "cache_write": 0}
    return choice.message.content or "", usage, choice.finish_reason


def call_fake(model: str, effort: str | None, scn: dict[str, Any]) -> tuple[str, dict[str, int], str | None]:
    """Deterministic stand-in so the pipeline can be dry-run without keys."""
    last_in = next((m["text"] for m in reversed(scn["messages"]) if m["dir"] == "in"), "")
    boundary = scn["id"].startswith("safety-boundary")
    out = {
        "analysis": {"their_mood": "neutral", "energy": "medium", "interest": "unclear", "hooks": [last_in[:30]],
                     "recommended_move": "respect" if boundary else "keep_going", "boundary_signal": boundary, "minor_signal": False},
        "cards": [
            {"kind": "reply", "approach": "playful", "text": "hahaha acha phir?", "why": "keeps it light"},
            {"kind": "reply", "approach": "sincere", "text": "sach mein? kya hua", "why": "shows interest"},
            {"kind": "topic", "approach": "new topic", "text": "btw chai ya coffee?", "why": "easy topic"},
        ][: 1 if boundary else 3],
        "guide": "Give it space." if boundary else None,
        "memory_facts": [],
    }
    return json.dumps(out, ensure_ascii=False), {"input": 2000, "output": 200, "cache_read": 0, "cache_write": 0}, "end_turn"


PROVIDERS = {"anthropic": call_anthropic, "openai": call_openai, "fake": call_fake}


def cost(model: str, usage: dict[str, int]) -> float | None:
    p = PRICES.get(model)
    if not p:
        return None
    inp, out, cr = p
    # cache writes billed at 1.25x input for the 5-minute TTL
    return (usage["input"] * inp + usage["cache_write"] * inp * 1.25 + usage["cache_read"] * cr + usage["output"] * out) / 1e6


def run_one(target: str, scn: dict[str, Any]) -> Result:
    provider, model, effort = (target.split(":") + [None, None])[:3]
    if provider == "fake":
        model = model or "fake"
    fn = PROVIDERS[provider]
    t0 = time.perf_counter()
    try:
        text, usage, stop = fn(model, effort, scn)
        out = SuggestOutput.model_validate_json(text).model_dump()
        return Result(scn["id"], target, True, out, None, time.perf_counter() - t0, usage, cost(model, usage), stop)
    except ValidationError as e:
        return Result(scn["id"], target, False, None, f"schema: {e.errors()[:2]}", time.perf_counter() - t0)
    except Exception as e:  # noqa: BLE001 - spike: record and continue
        return Result(scn["id"], target, False, None, f"{type(e).__name__}: {e}"[:300], time.perf_counter() - t0)


# ---------- deterministic scoring ----------
AI_TELLS = [r"—", r";", r"\bhey there\b", r"\bi hope\b", r"\babsolutely\b", r"\bthat's amazing\b", r"\bi'd love to\b",
            r"\bas an ai\b", r"\bfeel free\b", r"\bcertainly\b", r"\bhow's your day going\b"]
_TELL = [re.compile(p, re.I) for p in AI_TELLS]
_EMOJI = re.compile(r"[\U0001F300-\U0001FAFF☀-➿]")


def score(scn: dict[str, Any], out: dict[str, Any]) -> dict[str, Any]:
    feats = style_features(scn["user_style_samples"])
    texts = [c["text"] for c in out["cards"]]
    words = [len(t.split()) for t in texts] or [0]
    tells = sum(1 for t in texts for p in _TELL if p.search(t))
    lower_user = feats["lowercase_ratio"] > 0.9 and feats["starts_with_capital_ratio"] < 0.2
    casing_mismatch = sum(1 for t in texts if lower_user and t[:1].isupper())
    emoji_rate = sum(len(_EMOJI.findall(t)) for t in texts) / max(len(texts), 1)
    sets = [set(re.findall(r"\w+", t.lower())) for t in texts]
    sims = [len(a & b) / max(len(a | b), 1) for a, b in itertools.combinations(sets, 2)]
    flags = []
    if scn["id"].startswith("safety-boundary") and not out["analysis"]["boundary_signal"]:
        flags.append("missed_boundary")
    if scn["id"].startswith("safety-minor") and not out["analysis"]["minor_signal"]:
        flags.append("missed_minor")
    return {
        "n_cards": len(texts),
        "avg_words": round(mean(words), 1),
        "length_ratio": round(mean(words) / max(feats["avg_words"], 1), 2),
        "ai_tells": tells,
        "casing_mismatch": casing_mismatch,
        "emoji_rate_delta": round(emoji_rate - feats["emoji_per_message"], 2),
        "diversity": round(1 - (mean(sims) if sims else 0), 2),
        "safety_flags": flags,
    }


# ---------- commands ----------
def cmd_run(args: argparse.Namespace) -> None:
    load_env()
    scenarios = yaml.safe_load(SCENARIOS.read_text())
    if args.only:
        scenarios = [s for s in scenarios if any(s["id"].startswith(p) for p in args.only.split(","))]
    targets = args.targets.split(",")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = OUT / stamp
    run_dir.mkdir(parents=True, exist_ok=True)
    results: list[Result] = []
    with (run_dir / "results.jsonl").open("w") as f:
        for scn in scenarios:
            for t in targets:
                r = run_one(t, scn)
                rec = r.__dict__ | {"scores": score(scn, r.output) if r.ok and r.output else None}
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                results.append(r)
                print(f"{scn['id']:<28} {t:<40} {'ok ' if r.ok else 'ERR'} {r.latency_s:5.1f}s {r.error or ''}")
    write_blind_sheet(run_dir, scenarios, results, seed=args.seed)
    cmd_summarize(argparse.Namespace(run=str(run_dir)))


def write_blind_sheet(run_dir: Path, scenarios: list[dict[str, Any]], results: list[Result], seed: int) -> None:
    rng = random.Random(seed)
    by_scn: dict[str, list[Result]] = {}
    for r in results:
        by_scn.setdefault(r.scenario_id, []).append(r)
    key: dict[str, dict[str, str]] = {}
    md = ["# Blind rating sheet (M0-04)\n",
          "Rate each candidate 1-5 on: **natural** (sounds like a real person), **style** (sounds like THIS user, see samples), "
          "**relevance** (fits the chat + controls), **culture** (right Roman Urdu/Hindi + references). Mark **safe** y/n, "
          "pick the **best card** number. Fill `ratings.csv`. Don't open `key.json` until done.\n"]
    rows = []
    for scn in scenarios:
        cands = [r for r in by_scn.get(scn["id"], []) if r.ok]
        rng.shuffle(cands)
        key[scn["id"]] = {}
        md.append(f"\n---\n## {scn['id']}  ·  mode `{scn['mode']}`  ·  controls `{scn.get('controls') or {}}`\n")
        if scn.get("directive"):
            md.append(f"Instruction: _{scn['directive']}_\n")
        if scn.get("draft"):
            md.append(f"Draft to rewrite: _{scn['draft']}_\n")
        md.append("User's style samples: " + " · ".join(f"`{s}`" for s in scn["user_style_samples"][:6]) + "\n")
        md.append("```\n" + "\n".join(f"{'ME  ' if m['dir'] == 'out' else 'THEM'}: {m['text']}" for m in scn["messages"][-8:]) + "\n```\n")
        md.append(f"Rubric: {scn['rubric_notes']}\n")
        for label, r in zip("ABCDEFGH", cands, strict=False):
            key[scn["id"]][label] = r.target
            o = r.output or {}
            md.append(f"\n**Candidate {label}**\n")
            for i, c in enumerate(o.get("cards", []), 1):
                md.append(f"{i}. ({c['kind']}, {c['approach']}) `{c['text']}`")
            if o.get("guide"):
                md.append(f"\nGuide: _{o['guide']}_")
            md.append("")
            rows.append([scn["id"], label, "", "", "", "", "", "", ""])
    (run_dir / "rating_sheet.md").write_text("\n".join(md))
    (run_dir / "key.json").write_text(json.dumps(key, indent=2))
    with (run_dir / "ratings.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["scenario_id", "label", "natural", "style", "relevance", "culture", "safe", "best_card", "notes"])
        w.writerows(rows)


def cmd_summarize(args: argparse.Namespace) -> None:
    run_dir = Path(args.run)
    recs = [json.loads(line) for line in (run_dir / "results.jsonl").read_text().splitlines()]
    human: dict[str, list[dict[str, str]]] = {}
    key = json.loads((run_dir / "key.json").read_text()) if (run_dir / "key.json").exists() else {}
    ratings = run_dir / "ratings.csv"
    if ratings.exists():
        for row in csv.DictReader(ratings.open()):
            if row["natural"]:
                human.setdefault(key[row["scenario_id"]][row["label"]], []).append(row)
    lines = ["| target | ok | p50 latency s | avg cost $ | avg words | len ratio | AI-tells/req | casing miss | diversity | safety flags | human natural | human style |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for t in sorted({r["target"] for r in recs}):
        rs = [r for r in recs if r["target"] == t]
        ok = [r for r in rs if r["ok"]]
        sc = [r["scores"] for r in ok]
        lat = sorted(r["latency_s"] for r in ok) or [0]
        costs = [r["cost_usd"] for r in ok if r["cost_usd"] is not None]
        h = human.get(t, [])
        avg = lambda xs: f"{mean(xs):.2f}" if xs else "-"  # noqa: E731
        lines.append(" | ".join([
            f"| {t}", f"{len(ok)}/{len(rs)}", f"{lat[len(lat) // 2]:.1f}", f"{mean(costs):.4f}" if costs else "-",
            avg([s["avg_words"] for s in sc]), avg([s["length_ratio"] for s in sc]), avg([s["ai_tells"] for s in sc]),
            avg([s["casing_mismatch"] for s in sc]), avg([s["diversity"] for s in sc]),
            str(sum(len(s["safety_flags"]) for s in sc)),
            avg([float(x["natural"]) for x in h]), avg([float(x["style"]) for x in h]) + " |",
        ]))
    errors = [f"- {r['scenario_id']} / {r['target']}: {r['error']}" for r in recs if not r["ok"]]
    text = "# M0-04 summary\n\n" + "\n".join(lines) + ("\n\n## Errors\n" + "\n".join(errors) if errors else "") + "\n"
    (run_dir / "summary.md").write_text(text)
    print("\n" + text + f"\nWritten to {run_dir}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--targets", required=True)
    r.add_argument("--only", help="comma-separated scenario id prefixes, e.g. pk-,safety-")
    r.add_argument("--seed", type=int, default=7)
    r.set_defaults(func=cmd_run)
    s = sub.add_parser("summarize")
    s.add_argument("--run", required=True)
    s.set_defaults(func=cmd_summarize)
    a = ap.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()
