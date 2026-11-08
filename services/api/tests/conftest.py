import asyncio
import os
from collections.abc import AsyncIterator

import pytest
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from alembic import command
from app.db.session import get_session
from app.main import create_app
from app.settings import Settings

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://wingman:wingman@localhost:5432/wingman_test"
)


def alembic_config() -> Config:
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    return cfg


async def _ensure_database() -> None:
    url = make_url(TEST_DATABASE_URL)
    admin = create_async_engine(
        url.set(database="postgres"), isolation_level="AUTOCOMMIT", poolclass=NullPool
    )
    async with admin.connect() as conn:
        exists = await conn.scalar(
            text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": url.database}
        )
        if not exists:
            await conn.execute(text(f'CREATE DATABASE "{url.database}"'))
    await admin.dispose()


@pytest.fixture(scope="session", autouse=True)
def _migrated_database() -> None:
    asyncio.run(_ensure_database())
    command.upgrade(alembic_config(), "head")


@pytest.fixture(autouse=True)
async def _clean_tables(_migrated_database: None) -> None:
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE users, chat_refs, suggestion_requests CASCADE"))
    await engine.dispose()


@pytest.fixture
async def sessionmaker() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def client(sessionmaker: async_sessionmaker[AsyncSession]) -> AsyncIterator[AsyncClient]:
    app = create_app(Settings(app_env="test", jwt_private_key=""))

    async def override() -> AsyncIterator[AsyncSession]:
        async with sessionmaker() as session:
            yield session

    app.dependency_overrides[get_session] = override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
