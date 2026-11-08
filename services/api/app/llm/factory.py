"""Build the process-wide gateway from settings."""

from __future__ import annotations

from functools import lru_cache

import structlog

from app.llm.gateway import Gateway, load_routes
from app.llm.providers import Provider
from app.llm.providers.fake import FakeProvider
from app.llm.types import Target
from app.settings import Settings, get_settings

log = structlog.get_logger(__name__)


def build_gateway(settings: Settings) -> Gateway:
    routes = load_routes(settings.llm_routes_file)
    providers: dict[str, Provider] = {}
    if settings.llm_mode != "fake":
        if settings.anthropic_api_key:
            from app.llm.providers.anthropic import AnthropicProvider

            providers["anthropic"] = AnthropicProvider(settings.anthropic_api_key)
        if settings.openai_api_key:
            from app.llm.providers.openai import OpenAIProvider

            providers["openai"] = OpenAIProvider(settings.openai_api_key)
    if not providers:
        if settings.app_env == "prod":
            raise RuntimeError("no LLM provider keys configured in prod")
        log.warning(
            "llm.fake_mode", reason=settings.llm_mode == "fake" and "configured" or "no keys"
        )
        providers["fake"] = FakeProvider()
        routes = {r: [Target(provider="fake", model="fake")] for r in routes}
    return Gateway(routes, providers)


@lru_cache
def get_gateway() -> Gateway:
    return build_gateway(get_settings())
