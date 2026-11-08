"""initial schema

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")
    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("email", postgresql.CITEXT(), nullable=False),
        sa.Column("google_sub", sa.Text(), nullable=True),
        sa.Column("display_name", sa.Text(), nullable=True),
        sa.Column("locale", sa.Text(), nullable=True),
        sa.Column("age_confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("plan", sa.Text(), server_default="alpha", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("google_sub"),
    )
    op.create_table(
        "chat_refs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("chat_key", sa.Text(), nullable=False),
        sa.Column("platform", sa.Text(), nullable=True),
        sa.Column("stage", sa.Text(), nullable=True),
        sa.Column(
            "settings",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "chat_key"),
    )
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rotated_from", sa.UUID(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["rotated_from"], ["refresh_tokens.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(op.f("ix_refresh_tokens_user_id"), "refresh_tokens", ["user_id"], unique=False)
    op.create_table(
        "user_settings",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("default_tone", sa.Text(), nullable=True),
        sa.Column("default_objective", sa.Text(), nullable=True),
        sa.Column("lang_pref", sa.Text(), server_default="auto", nullable=False),
        sa.Column("emoji_level", sa.SmallInteger(), server_default="1", nullable=False),
        sa.Column("auto_suggest", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("data_donation", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("style_learning", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "suggestion_requests",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("chat_ref_id", sa.UUID(), nullable=True),
        sa.Column("mode", sa.Text(), nullable=False),
        sa.Column("trigger", sa.Text(), nullable=True),
        sa.Column(
            "controls",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("prompt_version", sa.Text(), nullable=True),
        sa.Column("route", sa.Text(), nullable=True),
        sa.Column("model", sa.Text(), nullable=True),
        sa.Column("latency_first_ms", sa.Integer(), nullable=True),
        sa.Column("latency_total_ms", sa.Integer(), nullable=True),
        sa.Column("tokens_in", sa.Integer(), nullable=True),
        sa.Column("tokens_cached", sa.Integer(), nullable=True),
        sa.Column("tokens_out", sa.Integer(), nullable=True),
        sa.Column("cost_usd", sa.Numeric(precision=10, scale=6), nullable=True),
        sa.Column(
            "safety_flags",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'::text[]"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["chat_ref_id"], ["chat_refs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_suggestion_requests_user_id"), "suggestion_requests", ["user_id"], unique=False
    )
    op.create_table(
        "suggestions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("request_id", sa.UUID(), nullable=False),
        sa.Column("rank", sa.SmallInteger(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("approach", sa.Text(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "example_ids",
            postgresql.ARRAY(sa.UUID()),
            server_default=sa.text("'{}'::uuid[]"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["request_id"], ["suggestion_requests.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_suggestions_request_id"), "suggestions", ["request_id"], unique=False)
    op.create_table(
        "feedback_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("suggestion_id", sa.UUID(), nullable=True),
        sa.Column("request_id", sa.UUID(), nullable=True),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column(
            "value",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("client_ts", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["request_id"], ["suggestion_requests.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["suggestion_id"], ["suggestions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_feedback_events_user_id"), "feedback_events", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_feedback_events_user_id"), table_name="feedback_events")
    op.drop_table("feedback_events")
    op.drop_index(op.f("ix_suggestions_request_id"), table_name="suggestions")
    op.drop_table("suggestions")
    op.drop_index(op.f("ix_suggestion_requests_user_id"), table_name="suggestion_requests")
    op.drop_table("suggestion_requests")
    op.drop_table("user_settings")
    op.drop_index(op.f("ix_refresh_tokens_user_id"), table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
    op.drop_table("chat_refs")
    op.drop_table("users")
