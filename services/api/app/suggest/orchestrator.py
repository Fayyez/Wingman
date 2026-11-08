"""Suggestion pipeline (docs/03 §5): prompt assembly → gateway stream → incremental card
extraction → validation, clean-up, de-dup → SSE events. Pure of HTTP and DB concerns: the router
persists the `SuggestRun` record (metadata + our generated card text, never chat content)."""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import structlog
from pydantic import BaseModel, ValidationError

from app.llm.gateway import Gateway
from app.llm.stream_json import SuggestStreamParser
from app.llm.types import AllTargetsFailed, Final, LLMError, LLMRequest, LLMResult, TextDelta
from app.prompts.registry import render_suggest
from app.style.features import style_features
from app.suggest.postprocess import normalized, scrub_ai_tells
from app.suggest.schemas import (
    OUTPUT_SCHEMA,
    Analysis,
    AnalysisEvent,
    Card,
    CardEvent,
    DoneEvent,
    ErrorEvent,
    GuideEvent,
    MemoryEvent,
    MetaEvent,
    SuggestOutput,
    SuggestRequest,
)

log = structlog.get_logger(__name__)
PROMPT_VERSION = "v1"
ROUTE_FOR_MODE = {"rewrite": "rewrite"}


@dataclass
class SuggestRun:
    """What the router persists after the stream ends."""

    route: str = "suggest"
    prompt_version: str = ""
    result: LLMResult | None = None
    cards: list[CardEvent] = field(default_factory=list)
    first_card_ms: int | None = None
    total_ms: int = 0
    error_code: str | None = None
    safety_flags: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class SSE:
    event: str
    data: BaseModel

    def encode(self) -> str:
        return f"event: {self.event}\ndata: {self.data.model_dump_json()}\n\n"


def build_llm_request(req: SuggestRequest) -> tuple[LLMRequest, str]:
    own = [m.text for m in req.messages if m.dir == "out" and m.kind == "text" and m.text]
    controls = req.controls.model_dump(exclude_none=True, exclude={"count"})
    prompt = render_suggest(
        version=PROMPT_VERSION,
        chat=req.chat.model_dump(),
        memory=req.memory.model_dump(),
        messages=[m.model_dump() for m in req.messages],
        mode=req.mode,
        controls=controls,
        count=req.controls.count,
        style_features=style_features(own),
        style_samples=own[-12:],
        style_cacheable=False,  # M2: True when the style block comes from a stored profile
        directive=req.directive,
        draft=req.draft,
        avoid=req.avoid,
        tweak=req.tweak,
    )
    route = ROUTE_FOR_MODE.get(req.mode, "suggest")
    llm_req = LLMRequest(
        route=route,
        system=prompt.system,
        user=prompt.user,
        output_schema=OUTPUT_SCHEMA,
        max_output_tokens=4000,
        metadata={"request_id": str(req.request_id), "prompt_version": prompt.version},
    )
    return llm_req, prompt.version


async def run_suggest(req: SuggestRequest, gateway: Gateway, run: SuggestRun) -> AsyncIterator[SSE]:
    t0 = time.perf_counter()
    llm_req, version = build_llm_request(req)
    run.route, run.prompt_version = llm_req.route, version
    yield SSE("meta", MetaEvent(request_id=req.request_id, prompt_version=version))

    parser = SuggestStreamParser()
    seen: set[str] = {normalized(a) for a in req.avoid}
    seen_approaches: set[str] = set()
    analysis_sent = False

    def card_event(raw: dict[str, Any]) -> CardEvent | None:
        try:
            card = Card.model_validate(raw)
        except ValidationError:
            return None
        text = scrub_ai_tells(card.text)
        key = normalized(text)
        if not key or key in seen or len(run.cards) >= req.controls.count:
            return None
        seen.add(key)
        seen_approaches.add(card.approach.lower())
        ev = CardEvent(
            id=uuid.uuid4(),
            rank=len(run.cards) + 1,
            kind=card.kind,
            approach=card.approach,
            text=text,
            why=card.why or None,
        )
        run.cards.append(ev)
        if run.first_card_ms is None:
            run.first_card_ms = int((time.perf_counter() - t0) * 1000)
        return ev

    try:
        async for ev in gateway.stream(llm_req):
            if isinstance(ev, TextDelta):
                for kind, obj in parser.feed(ev.text):
                    if kind == "analysis" and not analysis_sent:
                        a = _analysis(obj)
                        if a is not None:
                            analysis_sent = True
                            yield SSE("analysis", a)
                    elif kind == "card":
                        ce = card_event(obj)
                        if ce is not None:
                            yield SSE("card", ce)
            elif isinstance(ev, Final):
                run.result = ev.result
        out = SuggestOutput.model_validate(parser.document())
    except AllTargetsFailed as e:
        run.error_code = "llm_unavailable"
        log.error("suggest.llm_unavailable", errors=e.errors, request_id=str(req.request_id))
        yield SSE(
            "error",
            ErrorEvent(code="llm_unavailable", message="Suggestions are unavailable right now."),
        )
        return
    except (LLMError, ValidationError, json.JSONDecodeError) as e:
        run.error_code = "bad_output"
        log.error("suggest.bad_output", error=type(e).__name__, request_id=str(req.request_id))
        if not run.cards:
            yield SSE(
                "error",
                ErrorEvent(code="bad_output", message="Couldn't generate suggestions, try again."),
            )
            return
        out = None

    if out is not None:
        if not analysis_sent:
            yield SSE("analysis", _analysis_from(out.analysis))
        for c in out.cards:  # cards the incremental parser may have missed
            ce = card_event(c.model_dump())
            if ce is not None:
                yield SSE("card", ce)
        if out.analysis.boundary_signal:
            run.safety_flags.append("boundary_signal")
        if out.analysis.minor_signal:
            run.safety_flags.append("minor_signal")
        if out.guide:
            yield SSE("guide", GuideEvent(text=scrub_ai_tells(out.guide)))
        facts = [f.strip() for f in out.memory_facts if f.strip()][:3]
        if facts:
            yield SSE("memory", MemoryEvent(facts_add=facts))

    run.total_ms = int((time.perf_counter() - t0) * 1000)
    yield SSE(
        "done",
        DoneEvent(latency_ms=run.total_ms, first_card_ms=run.first_card_ms, cards=len(run.cards)),
    )


def _analysis(obj: dict[str, Any]) -> AnalysisEvent | None:
    try:
        return _analysis_from(Analysis.model_validate(obj))
    except ValidationError:
        return None


def _analysis_from(a: Analysis) -> AnalysisEvent:
    return AnalysisEvent(**a.model_dump(exclude={"minor_signal"}))
