"""Optional Sentry setup. Never sends PII or request bodies."""

from typing import Any

import sentry_sdk


def _before_send(event: Any, _hint: Any) -> Any:
    request = event.get("request")
    if isinstance(request, dict):
        for key in ("data", "cookies", "query_string"):
            request.pop(key, None)
        headers = request.get("headers")
        if isinstance(headers, dict):
            for h in list(headers):
                if h.lower() in {"authorization", "cookie"}:
                    headers.pop(h)
    return event


def init_sentry(dsn: str | None, environment: str) -> None:
    if not dsn:
        return
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        send_default_pii=False,
        max_request_body_size="never",
        before_send=_before_send,
    )
