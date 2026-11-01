"""Structured JSON logging. Privacy rule: conversation content is never logged."""

import logging
import sys
from collections.abc import Mapping, MutableMapping
from typing import Any

import structlog

SCRUBBED_KEYS = frozenset(
    {"text", "messages", "draft", "directive", "memory", "content", "prompt", "body"}
)
SCRUBBED = "[scrubbed]"


def _scrub(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {k: SCRUBBED if k in SCRUBBED_KEYS else _scrub(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    if isinstance(value, tuple):
        return tuple(_scrub(v) for v in value)
    return value


def scrub_processor(
    _logger: Any, _method: str, event_dict: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    """structlog processor replacing sensitive keys (recursively) with "[scrubbed]"."""
    scrubbed: dict[str, Any] = _scrub(dict(event_dict))
    return scrubbed


def configure_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(stream=sys.stdout, level=level, format="%(message)s")
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            scrub_processor,
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        cache_logger_on_first_use=True,
    )
