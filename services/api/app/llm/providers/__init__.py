from collections.abc import AsyncGenerator
from typing import Protocol

from app.llm.types import LLMRequest, StreamEvent, Target


class Provider(Protocol):
    name: str

    def stream(self, target: Target, req: LLMRequest) -> AsyncGenerator[StreamEvent, None]:
        """Yield TextDelta events, then exactly one Final. Raise LLMError subclasses."""
        ...
