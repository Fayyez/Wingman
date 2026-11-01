import httpx
import pytest

from app import __version__
from app.main import create_app


@pytest.mark.asyncio
async def test_healthz() -> None:
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "version": __version__}
