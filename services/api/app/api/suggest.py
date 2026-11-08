"""POST /v1/suggest: Server-Sent Events stream of analysis, cards, guide, memory delta."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from decimal import Decimal

import structlog
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.deps import get_current_user
from app.db.models import ChatRef, Suggestion, SuggestionRequest, User
from app.db.session import get_sessionmaker
from app.llm.factory import get_gateway
from app.llm.gateway import Gateway
from app.suggest.orchestrator import SuggestRun, run_suggest
from app.suggest.schemas import SSE_EVENT_MODELS, SuggestRequest

log = structlog.get_logger(__name__)
router = APIRouter(prefix="/v1", tags=["suggest"])


def gateway_dep() -> Gateway:
    return get_gateway()


def sessionmaker_dep() -> async_sessionmaker[AsyncSession]:
    """Own sessionmaker: persistence runs after the response body, outside request deps."""
    return get_sessionmaker()


SSE_DOC = (
    "Server-Sent Events. Event names and payload schemas: "
    + ", ".join(f"`{name}` → {m.__name__}" for name, m in SSE_EVENT_MODELS.items())
    + ". Order: meta, analysis?, card×1-3, guide?, memory?, then done or error."
)


@router.post(
    "/suggest",
    summary="Stream suggestions for the active chat",
    description=SSE_DOC,
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}}},
)
async def suggest(
    body: SuggestRequest,
    user: User = Depends(get_current_user),  # noqa: B008
    gateway: Gateway = Depends(gateway_dep),  # noqa: B008
    sm: async_sessionmaker[AsyncSession] = Depends(sessionmaker_dep),  # noqa: B008
) -> StreamingResponse:
    async def stream() -> AsyncIterator[str]:
        run = SuggestRun()
        try:
            async for sse in run_suggest(body, gateway, run):
                yield sse.encode()
        finally:
            # Persist metadata even if the client disconnected; shield from cancellation.
            await asyncio.shield(_persist(sm, user.id, body, run))

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _persist(
    sm: async_sessionmaker[AsyncSession], user_id: object, body: SuggestRequest, run: SuggestRun
) -> None:
    """Store request metadata + our generated cards. Never the conversation itself."""
    try:
        async with sm() as s:
            await s.execute(
                insert(ChatRef)
                .values(
                    user_id=user_id,
                    chat_key=body.chat.key,
                    platform=body.chat.platform,
                    stage=body.chat.stage,
                )
                .on_conflict_do_nothing(index_elements=["user_id", "chat_key"])
            )
            chat_ref_id = await s.scalar(
                select(ChatRef.id).where(
                    ChatRef.user_id == user_id, ChatRef.chat_key == body.chat.key
                )
            )
            r = run.result
            req = SuggestionRequest(
                id=body.request_id,
                user_id=user_id,
                chat_ref_id=chat_ref_id,
                mode=body.mode,
                trigger=body.trigger,
                controls=body.controls.model_dump(exclude_none=True)
                | ({"tweak": body.tweak} if body.tweak else {}),
                prompt_version=run.prompt_version,
                route=run.route,
                model=f"{r.provider}:{r.model}" if r else None,
                latency_first_ms=run.first_card_ms,
                latency_total_ms=run.total_ms,
                tokens_in=r.usage.input if r else None,
                tokens_cached=r.usage.cache_read if r else None,
                tokens_out=r.usage.output if r else None,
                cost_usd=Decimal(str(r.cost_usd)) if r and r.cost_usd is not None else None,
                safety_flags=run.safety_flags
                + ([f"error:{run.error_code}"] if run.error_code else []),
            )
            s.add(req)
            await s.flush()  # parent row first: suggestions FK → suggestion_requests
            s.add_all(
                Suggestion(
                    id=c.id,
                    request_id=req.id,
                    rank=c.rank,
                    kind=c.kind,
                    approach=c.approach,
                    text=c.text,
                    example_ids=[],
                )
                for c in run.cards
            )
            await s.commit()
    except Exception as e:  # noqa: BLE001 - persistence must never break a user-facing stream
        log.error("suggest.persist_failed", error=type(e).__name__, request_id=str(body.request_id))
