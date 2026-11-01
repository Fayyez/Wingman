"""Versioned prompt templates (docs/03 §6). Every request records `prompt_version`."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from app.llm.types import PromptBlock

PROMPTS_DIR = Path(__file__).parent

MODE_HINTS = {
    "auto": "Choose the best mix: usually 3 replies, or 2 replies + 1 topic if the chat is dying. "
    "Add a guide if useful.",
    "reply": "Give reply cards with clearly distinct approaches.",
    "topic": "Give topic cards: a ready-to-send opener line for a fresh topic, grounded in "
    "memory/culture.",
    "guide": "Focus on the guide (strategy). Give up to 2 example cards.",
    "rewrite": "Rewrite the user's draft keeping their intent and voice; one card should be a "
    "minimal edit.",
}


@lru_cache
def _env() -> Environment:
    return Environment(
        loader=FileSystemLoader(PROMPTS_DIR),
        undefined=StrictUndefined,
        autoescape=False,
        trim_blocks=False,
        keep_trailing_newline=False,
    )


def render(template: str, **ctx: Any) -> str:
    return _env().get_template(template).render(**ctx).strip()


@dataclass(frozen=True)
class RenderedPrompt:
    version: str
    system: list[PromptBlock]
    user: list[PromptBlock]


def render_suggest(
    *,
    version: str,
    chat: dict[str, Any],
    memory: dict[str, Any],
    messages: list[dict[str, Any]],
    mode: str,
    controls: dict[str, Any],
    count: int,
    style_features: dict[str, Any],
    style_samples: list[str],
    style_cacheable: bool,
    directive: str | None = None,
    draft: str | None = None,
    avoid: list[str] | None = None,
    tweak: str | None = None,
) -> RenderedPrompt:
    base = f"suggest/{version}"
    l1 = render(f"{base}/system.j2")
    l2 = render(f"{base}/style.j2", features=style_features, samples=style_samples)
    l3 = render(f"{base}/chat.j2", chat=chat, memory=memory)
    l4 = render(
        f"{base}/turn.j2",
        messages=messages,
        alias_upper=(chat.get("their_alias") or "them").upper(),
        mode=mode,
        mode_hint=MODE_HINTS[mode],
        controls=controls,
        count=count,
        directive=directive,
        draft=draft,
        avoid=avoid or [],
        tweak=tweak.replace("_", " ") if tweak else None,
    )
    # Cache breakpoints only where the prefix is stable across requests (docs/03 §6.1). A
    # window-derived style block changes every request, so it (and everything after) can't cache.
    return RenderedPrompt(
        version=f"suggest/{version}",
        system=[PromptBlock(l1, cache=True), PromptBlock(l2, cache=style_cacheable)],
        user=[PromptBlock(l3, cache=style_cacheable), PromptBlock(l4)],
    )
