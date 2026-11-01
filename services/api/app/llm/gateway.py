"""LLM gateway: routes a request to an ordered list of provider targets with cross-provider
fallback, a per-target circuit breaker, first-token timeouts and cost accounting.

Fallback happens only BEFORE the first token of a target is yielded. After that the caller has
already consumed partial output, so a mid-stream failure is raised to the caller."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import structlog
import yaml

from app.llm.pricing import cost_usd
from app.llm.providers import Provider
from app.llm.types import (
    AllTargetsFailed,
    Final,
    LLMError,
    LLMRequest,
    LLMResult,
    StreamEvent,
    Target,
    TextDelta,
)

log = structlog.get_logger(__name__)
DEFAULT_ROUTES = Path(__file__).with_name("routes.yaml")


@dataclass
class _BreakerState:
    failures: int = 0
    open_until: float = 0.0


class CircuitBreaker:
    """In-process breaker (Redis-backed version later). Opens after `threshold` consecutive
    retryable failures for `cooldown_s`."""

    def __init__(self, threshold: int = 3, cooldown_s: float = 30.0) -> None:
        self.threshold = threshold
        self.cooldown_s = cooldown_s
        self._s: dict[str, _BreakerState] = {}

    def is_open(self, key: str) -> bool:
        return self._s.get(key, _BreakerState()).open_until > time.monotonic()

    def success(self, key: str) -> None:
        self._s.pop(key, None)

    def failure(self, key: str) -> None:
        st = self._s.setdefault(key, _BreakerState())
        st.failures += 1
        if st.failures >= self.threshold:
            st.open_until = time.monotonic() + self.cooldown_s
            st.failures = 0


def load_routes(path: Path | str | None = None) -> dict[str, list[Target]]:
    raw: dict[str, list[dict[str, Any]]] = yaml.safe_load(Path(path or DEFAULT_ROUTES).read_text())
    return {route: [Target(**t) for t in targets] for route, targets in raw.items()}


class Gateway:
    def __init__(
        self,
        routes: Mapping[str, list[Target]],
        providers: Mapping[str, Provider],
        breaker: CircuitBreaker | None = None,
    ) -> None:
        self.routes = dict(routes)
        self.providers = dict(providers)
        self.breaker = breaker or CircuitBreaker()

    def targets_for(self, route: str) -> list[Target]:
        if route not in self.routes:
            raise LLMError(f"unknown route {route!r}")
        return [t for t in self.routes[route] if t.provider in self.providers]

    async def stream(self, req: LLMRequest) -> AsyncIterator[StreamEvent]:
        errors: list[str] = []
        targets = self.targets_for(req.route)
        if not targets:
            raise AllTargetsFailed(req.route, ["no configured provider for this route"])
        for target in targets:
            key = target.label
            if self.breaker.is_open(key):
                errors.append(f"{key}: circuit open")
                continue
            agen = self.providers[target.provider].stream(target, req)
            started = False
            try:
                async with asyncio.timeout(target.first_token_timeout_s):
                    first = await anext(agen)
                started = True
                async for ev in _chain(first, agen):
                    if isinstance(ev, Final):
                        r = ev.result
                        r.cost_usd = cost_usd(r.model, r.usage)
                        r.attempts = errors
                        self.breaker.success(key)
                        log.info(
                            "llm.done",
                            route=req.route,
                            target=key,
                            served_model=r.model,
                            ms=r.latency_ms,
                            first_ms=r.first_token_ms,
                            tokens_in=r.usage.input,
                            tokens_cached=r.usage.cache_read,
                            tokens_out=r.usage.output,
                            cost_usd=r.cost_usd,
                            fallbacks=len(errors),
                            **req.metadata,
                        )
                    yield ev
                return
            except (TimeoutError, LLMError) as e:
                retryable = isinstance(e, TimeoutError) or getattr(e, "retryable", False)
                if retryable:
                    self.breaker.failure(key)
                msg = "first-token timeout" if isinstance(e, TimeoutError) else str(e)
                log.warning(
                    "llm.target_failed", route=req.route, target=key, error=msg, started=started
                )
                if started:
                    raise
                errors.append(f"{key}: {msg}")
            finally:
                await agen.aclose()
        raise AllTargetsFailed(req.route, errors)

    async def generate(self, req: LLMRequest) -> LLMResult:
        parts: list[str] = []
        result: LLMResult | None = None
        async for ev in self.stream(req):
            if isinstance(ev, TextDelta):
                parts.append(ev.text)
            else:
                result = ev.result
        assert result is not None
        return replace(result, text="".join(parts))


async def _chain(
    first: StreamEvent, rest: AsyncIterator[StreamEvent]
) -> AsyncIterator[StreamEvent]:
    yield first
    async for ev in rest:
        yield ev
