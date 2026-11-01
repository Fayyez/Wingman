"""Deterministic provider for tests and keyless local dev. Streams a canned JSON response in
small chunks so the streaming parser and SSE path are exercised for real."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator, Callable
from typing import Any

from app.llm.types import Final, LLMRequest, LLMResult, StreamEvent, Target, TextDelta, Usage

Responder = Callable[[LLMRequest], dict[str, Any] | str]


def _default_suggest(req: LLMRequest) -> dict[str, Any]:
    text = "\n".join(b.text for b in req.user)
    boundary = "mat karo" in text.lower() or "not interested" in text.lower()
    cards = [
        {
            "kind": "reply",
            "approach": "playful",
            "text": "hahaha acha phir?",
            "why": "keeps it light",
        },
        {
            "kind": "reply",
            "approach": "curious",
            "text": "sach mein? kya hua",
            "why": "shows interest",
        },
        {
            "kind": "topic",
            "approach": "new topic",
            "text": "btw chai ya coffee?",
            "why": "easy topic",
        },
    ]
    return {
        "analysis": {
            "their_mood": "neutral",
            "energy": "medium",
            "interest": "unclear",
            "hooks": [],
            "recommended_move": "respect_boundary" if boundary else "keep_going",
            "boundary_signal": boundary,
            "minor_signal": False,
        },
        "cards": cards[:1] if boundary else cards,
        "guide": "Give them space." if boundary else None,
        "memory_facts": [],
    }


class FakeProvider:
    name = "fake"

    def __init__(self, chunk_size: int = 24, delay_s: float = 0.0) -> None:
        self.chunk_size = chunk_size
        self.delay_s = delay_s
        self.responders: dict[str, Responder] = {"suggest": _default_suggest}
        self.fail_next: list[Exception] = []  # tests: raise these on the next calls

    async def stream(self, target: Target, req: LLMRequest) -> AsyncGenerator[StreamEvent, None]:
        if self.fail_next:
            raise self.fail_next.pop(0)
        responder = self.responders.get(req.route)
        payload = responder(req) if responder else {}
        text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
        for i in range(0, len(text), self.chunk_size):
            if self.delay_s:
                await asyncio.sleep(self.delay_s)
            yield TextDelta(text[i : i + self.chunk_size])
        yield Final(
            LLMResult(
                provider=self.name,
                model=target.model,
                stop_reason="end_turn",
                usage=Usage(
                    input=sum(len(b.text) for b in req.system + req.user) // 4,
                    output=len(text) // 4,
                ),
            )
        )
