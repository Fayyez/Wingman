"""Provider-neutral types for the LLM gateway (docs/02 ADR-08, docs/03 §7)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class PromptBlock:
    """A chunk of prompt text. `cache=True` places a provider cache breakpoint after it.
    Order blocks from most to least stable (docs/03 §6.1)."""

    text: str
    cache: bool = False


@dataclass
class LLMRequest:
    route: str
    system: list[PromptBlock]
    user: list[PromptBlock]
    output_schema: dict[str, Any] | None = None
    max_output_tokens: int = 4000
    # Non-content metadata only (request id, user hash, prompt version). Never chat text.
    metadata: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Target:
    provider: str
    model: str
    effort: str | None = None
    first_token_timeout_s: float = 8.0
    max_output_tokens: int | None = None

    @property
    def label(self) -> str:
        return f"{self.provider}:{self.model}" + (f":{self.effort}" if self.effort else "")


@dataclass
class Usage:
    input: int = 0
    output: int = 0
    cache_read: int = 0
    cache_write: int = 0


@dataclass
class LLMResult:
    provider: str
    model: str
    stop_reason: str | None
    usage: Usage
    latency_ms: int = 0
    first_token_ms: int = 0
    cost_usd: float | None = None
    attempts: list[str] = field(default_factory=list)  # failed target labels before success
    text: str = ""


@dataclass(frozen=True)
class TextDelta:
    text: str


@dataclass(frozen=True)
class Final:
    result: LLMResult


StreamEvent = TextDelta | Final


class LLMError(Exception):
    """Base gateway error. `retryable` errors trip the circuit breaker; any error before the
    first token moves on to the next target."""

    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


class RefusalError(LLMError):
    def __init__(self, category: str | None) -> None:
        super().__init__(f"model declined (category={category})")
        self.category = category


class TruncatedError(LLMError):
    pass


class AllTargetsFailed(LLMError):
    def __init__(self, route: str, errors: list[str]) -> None:
        super().__init__(f"all targets failed for route {route!r}: {errors}", retryable=True)
        self.errors = errors
