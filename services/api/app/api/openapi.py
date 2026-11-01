"""Publish SSE payload models in OpenAPI components so the TS client gets typed events."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

from app.suggest.schemas import SSE_EVENT_MODELS


def install_openapi(app: FastAPI) -> None:
    def custom() -> dict[str, Any]:
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(
            title=app.title, version=app.version, routes=app.routes, description=app.description
        )
        comps = schema.setdefault("components", {}).setdefault("schemas", {})
        for model in SSE_EVENT_MODELS.values():
            js = model.model_json_schema(ref_template="#/components/schemas/{model}")
            for name, sub in js.pop("$defs", {}).items():
                comps.setdefault(name, sub)
            comps[model.__name__] = js
        comps["SuggestEventName"] = {"type": "string", "enum": list(SSE_EVENT_MODELS)}
        app.openapi_schema = schema
        return schema

    app.openapi = custom  # type: ignore[method-assign]
