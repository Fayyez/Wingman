"""USD per 1M tokens: (input, output, cache_read). List prices as of 2026-10; verify before
budgeting. Unknown models return None cost."""

from app.llm.types import Usage

PRICES: dict[str, tuple[float, float, float]] = {
    "claude-opus-5-5": (4.0, 20.0, 0.20),
    "claude-sonnet-5-5": (2.0, 10.0, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.01),
}
CACHE_WRITE_MULTIPLIER = 1.25  # 5-minute TTL cache writes


def cost_usd(model: str, u: Usage) -> float | None:
    p = PRICES.get(model)
    if p is None:
        return None
    inp, out, cr = p
    total = (
        u.input * inp
        + u.cache_write * inp * CACHE_WRITE_MULTIPLIER
        + u.cache_read * cr
        + u.output * out
    )
    return round(total / 1e6, 6)
