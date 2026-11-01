import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from alembic import command
from tests.conftest import TEST_DATABASE_URL, alembic_config

TABLES = {
    "users",
    "user_settings",
    "refresh_tokens",
    "chat_refs",
    "suggestion_requests",
    "suggestions",
    "feedback_events",
}


async def _tables() -> set[str]:
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    async with engine.connect() as conn:
        rows = await conn.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
        )
        names = {r[0] for r in rows}
    await engine.dispose()
    return names


async def test_upgrade_downgrade_roundtrip() -> None:
    cfg = alembic_config()
    assert TABLES <= await _tables()
    try:
        await asyncio.to_thread(command.downgrade, cfg, "base")
        assert not (TABLES & await _tables())
    finally:
        await asyncio.to_thread(command.upgrade, cfg, "head")
    assert TABLES <= await _tables()
