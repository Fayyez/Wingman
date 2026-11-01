import asyncio
import json
from collections.abc import AsyncGenerator

import pytest

from app.llm.gateway import CircuitBreaker, Gateway, load_routes
from app.llm.pricing import cost_usd
from app.llm.providers.fake import FakeProvider
from app.llm.stream_json import SuggestStreamParser
from app.llm.types import (
    AllTargetsFailed,
    Final,
    LLMError,
    LLMRequest,
    LLMResult,
    PromptBlock,
    StreamEvent,
    Target,
    TextDelta,
    Usage,
)

REQ = LLMRequest(route="suggest", system=[PromptBlock("sys", cache=True)], user=[PromptBlock("hi")])


class Scripted:
    """Provider that yields given chunks, optionally failing before/after the first token."""

    def __init__(
        self,
        name: str,
        chunks: list[str],
        *,
        fail_before: Exception | None = None,
        fail_after_first: Exception | None = None,
        delay: float = 0.0,
    ) -> None:
        self.name, self.chunks = name, chunks
        self.fail_before, self.fail_after_first, self.delay = fail_before, fail_after_first, delay
        self.calls = 0

    async def stream(self, target: Target, req: LLMRequest) -> AsyncGenerator[StreamEvent, None]:
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail_before:
            raise self.fail_before
        for i, c in enumerate(self.chunks):
            yield TextDelta(c)
            if i == 0 and self.fail_after_first:
                raise self.fail_after_first
        yield Final(
            LLMResult(
                provider=self.name,
                model=target.model,
                stop_reason="end_turn",
                usage=Usage(input=1000, output=100, cache_read=2000),
            )
        )


def gw(
    *providers: Scripted, timeout: float = 1.0, breaker: CircuitBreaker | None = None
) -> Gateway:
    targets = [Target(p.name, "claude-opus-5-5", first_token_timeout_s=timeout) for p in providers]
    return Gateway({"suggest": targets}, {p.name: p for p in providers}, breaker)


async def test_primary_success_with_cost() -> None:
    r = await gw(Scripted("a", ["he", "llo"])).generate(REQ)
    assert r.text == "hello" and r.attempts == []
    assert r.cost_usd == pytest.approx((1000 * 4 + 2000 * 0.2 + 100 * 20) / 1e6)


async def test_falls_back_on_error_before_first_token() -> None:
    a = Scripted("a", [], fail_before=LLMError("boom", retryable=True))
    b = Scripted("b", ["ok"])
    r = await gw(a, b).generate(REQ)
    assert r.text == "ok" and r.provider == "b" and len(r.attempts) == 1


async def test_falls_back_on_first_token_timeout() -> None:
    a = Scripted("a", ["late"], delay=0.5)
    r = await gw(a, Scripted("b", ["fast"]), timeout=0.05).generate(REQ)
    assert r.text == "fast" and "timeout" in r.attempts[0]


async def test_mid_stream_failure_is_raised_not_hidden() -> None:
    a = Scripted("a", ["par", "tial"], fail_after_first=LLMError("cut", retryable=True))
    b = Scripted("b", ["never"])
    with pytest.raises(LLMError):
        await gw(a, b).generate(REQ)
    assert b.calls == 0


async def test_all_failed_and_circuit_breaker_skips_target() -> None:
    breaker = CircuitBreaker(threshold=2, cooldown_s=60)
    a = Scripted("a", [], fail_before=LLMError("x", retryable=True))
    g = gw(a, breaker=breaker)
    for _ in range(2):
        with pytest.raises(AllTargetsFailed):
            await g.generate(REQ)
    with pytest.raises(AllTargetsFailed) as e:
        await g.generate(REQ)
    assert a.calls == 2 and "circuit open" in e.value.errors[0]


async def test_unconfigured_provider_targets_are_skipped() -> None:
    g = Gateway(
        {"suggest": [Target("anthropic", "m"), Target("b", "m")]}, {"b": Scripted("b", ["y"])}
    )
    assert (await g.generate(REQ)).text == "y"


def test_routes_yaml_loads_and_unknown_model_has_no_cost() -> None:
    routes = load_routes()
    assert routes["suggest"][0].provider == "anthropic"
    assert cost_usd("unknown-model", Usage(input=10)) is None


async def test_fake_provider_produces_valid_json() -> None:
    g = Gateway({"suggest": [Target("fake", "fake")]}, {"fake": FakeProvider(chunk_size=5)})
    doc = json.loads((await g.generate(REQ)).text)
    assert len(doc["cards"]) == 3


@pytest.mark.parametrize("chunk", [1, 2, 7, 1000])
def test_stream_parser_emits_analysis_and_cards_under_any_chunking(chunk: int) -> None:
    doc = {
        "analysis": {"their_mood": "happy", "note": 'has } and { and "quotes" \\ inside'},
        "cards": [
            {"kind": "reply", "text": 'a {tricky} "one"', "why": "x"},
            {"kind": "topic", "text": "b [arr]", "why": "y"},
        ],
        "guide": None,
        "memory_facts": ["{not a card}"],
    }
    text = json.dumps(doc, ensure_ascii=False)
    p = SuggestStreamParser()
    events = []
    for i in range(0, len(text), chunk):
        events += p.feed(text[i : i + chunk])
    assert [k for k, _ in events] == ["analysis", "card", "card"]
    assert events[1][1]["text"] == 'a {tricky} "one"'
    assert p.document() == doc
