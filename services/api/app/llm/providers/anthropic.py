"""Anthropic adapter (official SDK). Structured output via output_config.format, prompt-cache
breakpoints from PromptBlock.cache, effort control, server-side refusal fallbacks where the
model supports them."""

from __future__ import annotations

import time
from collections.abc import AsyncGenerator
from typing import Any

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaTextBlockParam

from app.llm.types import (
    Final,
    LLMError,
    LLMRequest,
    LLMResult,
    PromptBlock,
    RefusalError,
    StreamEvent,
    Target,
    TextDelta,
    TruncatedError,
    Usage,
)

# Models that accept `fallbacks: "default"` on the Claude API
# (a declined request is re-run server-side on a fallback model).
FALLBACK_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1"}
RETRYABLE = (
    anthropic.RateLimitError,
    anthropic.InternalServerError,
    anthropic.APIConnectionError,
    anthropic.APITimeoutError,
    anthropic.ServiceUnavailableError,
    anthropic.OverloadedError,
)


def _blocks(blocks: list[PromptBlock]) -> list[BetaTextBlockParam]:
    out: list[BetaTextBlockParam] = []
    for b in blocks:
        block: BetaTextBlockParam = {"type": "text", "text": b.text}
        if b.cache:
            block["cache_control"] = {"type": "ephemeral"}
        out.append(block)
    return out


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str, *, timeout_s: float = 60.0) -> None:
        self.client = anthropic.AsyncAnthropic(api_key=api_key, timeout=timeout_s, max_retries=1)

    async def stream(self, target: Target, req: LLMRequest) -> AsyncGenerator[StreamEvent, None]:
        messages: list[BetaMessageParam] = [{"role": "user", "content": _blocks(req.user)}]
        kwargs: dict[str, Any] = {}
        if target.model in FALLBACK_MODELS:
            kwargs["betas"] = ["server-side-fallback-2026-07-01"]
            kwargs["fallbacks"] = "default"
        output_config: dict[str, Any] = {}
        if req.output_schema is not None:
            output_config["format"] = {"type": "json_schema", "schema": req.output_schema}
        if target.effort:
            output_config["effort"] = target.effort
        if output_config:
            kwargs["output_config"] = output_config

        t0 = time.perf_counter()
        first_ms = 0
        try:
            async with self.client.beta.messages.stream(
                model=target.model,
                max_tokens=target.max_output_tokens or req.max_output_tokens,
                system=_blocks(req.system),
                messages=messages,
                **kwargs,
            ) as s:
                async for text in s.text_stream:
                    if not first_ms:
                        first_ms = int((time.perf_counter() - t0) * 1000)
                    yield TextDelta(text)
                msg = await s.get_final_message()
        except RETRYABLE as e:
            raise LLMError(f"anthropic: {type(e).__name__}", retryable=True) from e
        except anthropic.APIStatusError as e:
            raise LLMError(f"anthropic: HTTP {e.status_code}") from e

        if msg.stop_reason == "refusal":
            details = getattr(msg, "stop_details", None)
            raise RefusalError(getattr(details, "category", None))
        if msg.stop_reason == "max_tokens":
            raise TruncatedError("anthropic: hit max_tokens")
        u = msg.usage
        usage = Usage(
            input=u.input_tokens or 0,
            output=u.output_tokens or 0,
            cache_read=getattr(u, "cache_read_input_tokens", 0) or 0,
            cache_write=getattr(u, "cache_creation_input_tokens", 0) or 0,
        )
        yield Final(
            LLMResult(
                provider=self.name,
                model=msg.model or target.model,  # reflects a server-side fallback model
                stop_reason=msg.stop_reason,
                usage=usage,
                latency_ms=int((time.perf_counter() - t0) * 1000),
                first_token_ms=first_ms,
            )
        )
