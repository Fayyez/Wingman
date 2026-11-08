"""ORM models per docs/03-system-design.md section 3.1.

Privacy: no conversation content is ever stored here.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy import (
    text as sa_text,
)
from sqlalchemy.dialects.postgresql import ARRAY, CITEXT, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def _ts() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(CITEXT(), unique=True)
    google_sub: Mapped[str | None] = mapped_column(Text, unique=True)
    display_name: Mapped[str | None] = mapped_column(Text)
    locale: Mapped[str | None] = mapped_column(Text)
    age_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    plan: Mapped[str] = mapped_column(Text, server_default="alpha", default="alpha")
    created_at: Mapped[datetime] = _ts()
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    settings: Mapped["UserSettings | None"] = relationship(
        back_populates="user", lazy="selectin", uselist=False, passive_deletes=True
    )


class UserSettings(Base):
    __tablename__ = "user_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    default_tone: Mapped[str | None] = mapped_column(Text)
    default_objective: Mapped[str | None] = mapped_column(Text)
    lang_pref: Mapped[str] = mapped_column(Text, server_default="auto", default="auto")
    emoji_level: Mapped[int] = mapped_column(SmallInteger, server_default="1", default=1)
    auto_suggest: Mapped[bool] = mapped_column(
        Boolean, server_default=sa_text("true"), default=True
    )
    data_donation: Mapped[bool] = mapped_column(
        Boolean, server_default=sa_text("false"), default=False
    )
    style_learning: Mapped[bool] = mapped_column(
        Boolean, server_default=sa_text("true"), default=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="settings")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(Text, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    rotated_from: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("refresh_tokens.id", ondelete="SET NULL")
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _ts()


class ChatRef(Base):
    __tablename__ = "chat_refs"
    __table_args__ = (UniqueConstraint("user_id", "chat_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    chat_key: Mapped[str] = mapped_column(Text)
    platform: Mapped[str | None] = mapped_column(Text)
    stage: Mapped[str | None] = mapped_column(Text)
    settings: Mapped[dict[str, Any]] = mapped_column(
        JSONB, server_default=sa_text("'{}'::jsonb"), default=dict
    )
    created_at: Mapped[datetime] = _ts()


class SuggestionRequest(Base):
    __tablename__ = "suggestion_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    chat_ref_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_refs.id", ondelete="SET NULL")
    )
    mode: Mapped[str] = mapped_column(Text)
    trigger: Mapped[str | None] = mapped_column(Text)
    controls: Mapped[dict[str, Any]] = mapped_column(
        JSONB, server_default=sa_text("'{}'::jsonb"), default=dict
    )
    prompt_version: Mapped[str | None] = mapped_column(Text)
    route: Mapped[str | None] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(Text)
    latency_first_ms: Mapped[int | None] = mapped_column(Integer)
    latency_total_ms: Mapped[int | None] = mapped_column(Integer)
    tokens_in: Mapped[int | None] = mapped_column(Integer)
    tokens_cached: Mapped[int | None] = mapped_column(Integer)
    tokens_out: Mapped[int | None] = mapped_column(Integer)
    cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(10, 6))
    safety_flags: Mapped[list[str]] = mapped_column(
        ARRAY(Text), server_default=sa_text("'{}'::text[]"), default=list
    )
    created_at: Mapped[datetime] = _ts()


class Suggestion(Base):
    __tablename__ = "suggestions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("suggestion_requests.id", ondelete="CASCADE"), index=True
    )
    rank: Mapped[int] = mapped_column(SmallInteger)
    kind: Mapped[str] = mapped_column(Text)
    approach: Mapped[str | None] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)  # our generated text, not third-party data
    example_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), server_default=sa_text("'{}'::uuid[]"), default=list
    )
    created_at: Mapped[datetime] = _ts()


class FeedbackEvent(Base):
    __tablename__ = "feedback_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    suggestion_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("suggestions.id", ondelete="SET NULL")
    )
    request_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("suggestion_requests.id", ondelete="SET NULL")
    )
    type: Mapped[str] = mapped_column(Text)
    value: Mapped[dict[str, Any]] = mapped_column(
        JSONB, server_default=sa_text("'{}'::jsonb"), default=dict
    )
    client_ts: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _ts()
