"""OpenAI adapter (official SDK): chat completions streaming with strict JSON-schema output."""

from __future__ import annotations

import time
from collections.abc import AsyncGenerator
from typing import Any

import openai

from app.llm.types import (
    Final,
    LLMError,
    LLMRequest,
    LLMResult,
    RefusalError,
    StreamEvent,
    Target,
    TextDelta,
    TruncatedError,
    Usage,
)

RETRYABLE = (
    openai.RateLimitError,
    openai.InternalServerError,
    openai.APIConnectionError,
    openai.APITimeoutError,
)


class OpenAIProvider:
    name = "openai"

    def __init__(self, api_key: str, *, timeout_s: float = 60.0) -> None:
        self.client = openai.AsyncOpenAI(api_key=api_key, timeout=timeout_s, max_retries=1)

    async def stream(self, target: Target, req: LLMRequest) -> AsyncGenerator[StreamEvent, None]:
        kwargs: dict[str, Any] = {}
        if req.output_schema is not None:
            kwargs["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": req.route, "strict": True, "schema": req.output_schema},
            }
        if target.effort:
            kwargs["reasoning_effort"] = target.effort
        t0 = time.perf_counter()
        first_ms = 0
        finish: str | None = None
        usage = Usage()
        try:
            stream = await self.client.chat.completions.create(
                model=target.model,
                max_completion_tokens=target.max_output_tokens or req.max_output_tokens,
                messages=[
                    {"role": "system", "content": "\n\n".join(b.text for b in req.system)},
                    {"role": "user", "content": "\n\n".join(b.text for b in req.user)},
                ],
                stream=True,
                stream_options={"include_usage": True},
                **kwargs,
            )
            async for chunk in stream:
                if chunk.usage:
                    cached = getattr(chunk.usage.prompt_tokens_details, "cached_tokens", 0) or 0
                    usage = Usage(
                        input=(chunk.usage.prompt_tokens or 0) - cached,
                        output=chunk.usage.completion_tokens or 0,
                        cache_read=cached,
                    )
                for choice in chunk.choices:
                    if getattr(choice.delta, "refusal", None):
                        raise RefusalError("openai")
                    if choice.delta.content:
                        if not first_ms:
                            first_ms = int((time.perf_counter() - t0) * 1000)
                        yield TextDelta(choice.delta.content)
                    finish = choice.finish_reason or finish
        except RETRYABLE as e:
            raise LLMError(f"openai: {type(e).__name__}", retryable=True) from e
        except openai.APIStatusError as e:
            raise LLMError(f"openai: HTTP {e.status_code}") from e
        if finish == "length":
            raise TruncatedError("openai: hit max tokens")
        yield Final(
            LLMResult(
                provider=self.name,
                model=target.model,
                stop_reason=finish,
                usage=usage,
                latency_ms=int((time.perf_counter() - t0) * 1000),
                first_token_ms=first_ms,
            )
        )
