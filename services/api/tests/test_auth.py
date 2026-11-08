import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth import google, tokens
from app.db.models import (
    RefreshToken,
    Suggestion,
    SuggestionRequest,
    User,
    UserSettings,
)
from app.db.session import get_session
from app.main import create_app
from app.settings import Settings

Sm = async_sessionmaker[AsyncSession]


async def dev_login(client: AsyncClient, email: str = "a@example.com") -> dict[str, str]:
    r = await client.post("/v1/auth/dev", json={"email": email})
    assert r.status_code == 200, r.text
    data: dict[str, str] = r.json()
    return data


def bearer(tok: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tok['access_token']}"}


async def test_dev_login_and_me(client: AsyncClient) -> None:
    tok = await dev_login(client)
    assert tok["token_type"] == "bearer"
    assert tok["expires_in"] == 900
    r = await client.get("/v1/me", headers=bearer(tok))
    assert r.status_code == 200
    me = r.json()
    assert me["email"] == "a@example.com"
    assert me["plan"] == "alpha"
    assert me["settings"]["auto_suggest"] is True
    assert me["settings"]["data_donation"] is False
    assert me["settings"]["emoji_level"] == 1
    # same email -> same user
    tok2 = await dev_login(client)
    me2 = (await client.get("/v1/me", headers=bearer(tok2))).json()
    assert me2["id"] == me["id"]


async def test_access_token_claims(client: AsyncClient) -> None:
    tok = await dev_login(client)
    claims = jwt.decode(
        tok["access_token"], tokens.get_keys().public, algorithms=["EdDSA"], issuer="wingman"
    )
    assert claims["typ"] == "access"
    assert claims["exp"] - claims["iat"] == 900
    uuid.UUID(claims["sub"])


async def test_google_login(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def fake(token: str) -> google.GoogleIdentity:
        if token != "good":
            raise ValueError("bad")
        return google.GoogleIdentity(sub="g-123", email="G@Example.com", name="Gee")

    monkeypatch.setattr(google, "verify_google_id_token", fake)
    r = await client.post("/v1/auth/google", json={"id_token": "good"})
    assert r.status_code == 200
    tok = r.json()
    me = (await client.get("/v1/me", headers=bearer(tok))).json()
    assert me["display_name"] == "Gee"
    # second login reuses the user
    tok2 = (await client.post("/v1/auth/google", json={"id_token": "good"})).json()
    assert (await client.get("/v1/me", headers=bearer(tok2))).json()["id"] == me["id"]

    bad = await client.post("/v1/auth/google", json={"id_token": "nope"})
    assert bad.status_code == 401
    assert bad.json()["error"]["code"] == "invalid_google_token"


async def test_settings_patch(client: AsyncClient) -> None:
    tok = await dev_login(client)
    r = await client.patch(
        "/v1/me/settings",
        headers=bearer(tok),
        json={"default_tone": "playful", "emoji_level": 3, "auto_suggest": False},
    )
    assert r.status_code == 200
    s = r.json()["settings"]
    assert s["default_tone"] == "playful"
    assert s["emoji_level"] == 3
    assert s["auto_suggest"] is False
    assert s["style_learning"] is True  # untouched

    # reset nullable field
    r = await client.patch("/v1/me/settings", headers=bearer(tok), json={"default_tone": None})
    assert r.json()["settings"]["default_tone"] is None
    assert r.json()["settings"]["emoji_level"] == 3


@pytest.mark.parametrize(
    "payload",
    [
        {"default_tone": "grumpy"},
        {"default_objective": "world_domination"},
        {"lang_pref": "klingon"},
        {"emoji_level": 4},
        {"emoji_level": -1},
        {"auto_suggest": None},
        {"unknown_field": 1},
    ],
)
async def test_settings_patch_validation(client: AsyncClient, payload: dict[str, object]) -> None:
    tok = await dev_login(client)
    r = await client.patch("/v1/me/settings", headers=bearer(tok), json=payload)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"


async def test_refresh_rotation(client: AsyncClient, sessionmaker: Sm) -> None:
    tok = await dev_login(client)
    r = await client.post("/v1/auth/refresh", json={"refresh_token": tok["refresh_token"]})
    assert r.status_code == 200
    new = r.json()
    assert new["refresh_token"] != tok["refresh_token"]
    assert (await client.get("/v1/me", headers=bearer(new))).status_code == 200
    async with sessionmaker() as s:
        rows = (
            (await s.execute(select(RefreshToken).order_by(RefreshToken.created_at)))
            .scalars()
            .all()
        )
        assert len(rows) == 2
        old, fresh = rows
        assert old.revoked_at is not None
        assert fresh.revoked_at is None
        assert fresh.rotated_from == old.id
        # only hashes are stored
        assert tok["refresh_token"] not in (old.token_hash, fresh.token_hash)
        assert old.token_hash == tokens.hash_refresh_token(tok["refresh_token"])


async def test_refresh_reuse_revokes_chain(client: AsyncClient, sessionmaker: Sm) -> None:
    tok = await dev_login(client)
    new = (
        await client.post("/v1/auth/refresh", json={"refresh_token": tok["refresh_token"]})
    ).json()
    reuse = await client.post("/v1/auth/refresh", json={"refresh_token": tok["refresh_token"]})
    assert reuse.status_code == 401
    assert reuse.json()["error"]["code"] == "unauthorized"
    # the newest token in the chain is now dead too
    again = await client.post("/v1/auth/refresh", json={"refresh_token": new["refresh_token"]})
    assert again.status_code == 401
    async with sessionmaker() as s:
        live = await s.scalar(
            select(func.count()).select_from(RefreshToken).where(RefreshToken.revoked_at.is_(None))
        )
        assert live == 0


async def test_refresh_expired_and_garbage(client: AsyncClient, sessionmaker: Sm) -> None:
    tok = await dev_login(client)
    async with sessionmaker() as s:
        await s.execute(update(RefreshToken).values(expires_at=datetime.now(UTC) - timedelta(1)))
        await s.commit()
    r = await client.post("/v1/auth/refresh", json={"refresh_token": tok["refresh_token"]})
    assert r.status_code == 401
    r = await client.post("/v1/auth/refresh", json={"refresh_token": "garbage"})
    assert r.status_code == 401


async def test_bad_access_tokens(client: AsyncClient) -> None:
    tok = await dev_login(client)
    uid = jwt.decode(tok["access_token"], options={"verify_signature": False})["sub"]
    past = datetime.now(UTC) - timedelta(hours=1)
    expired = jwt.encode(
        {
            "sub": uid,
            "iat": past,
            "exp": past + timedelta(minutes=15),
            "typ": "access",
            "iss": "wingman",
        },
        tokens.get_keys().private,
        algorithm="EdDSA",
    )
    wrong_typ = jwt.encode(
        {
            "sub": uid,
            "iat": datetime.now(UTC),
            "exp": datetime.now(UTC) + timedelta(minutes=5),
            "typ": "refresh",
            "iss": "wingman",
        },
        tokens.get_keys().private,
        algorithm="EdDSA",
    )
    for bad in ("garbage", expired, wrong_typ):
        r = await client.get("/v1/me", headers={"Authorization": f"Bearer {bad}"})
        assert r.status_code == 401, bad
        assert r.json()["error"]["code"] == "unauthorized"
    r = await client.get("/v1/me")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


async def test_delete_me_cascades(client: AsyncClient, sessionmaker: Sm) -> None:
    tok = await dev_login(client)
    me = (await client.get("/v1/me", headers=bearer(tok))).json()
    uid = uuid.UUID(me["id"])
    async with sessionmaker() as s:
        req = SuggestionRequest(user_id=uid, mode="reply")
        s.add(req)
        await s.flush()
        s.add(Suggestion(request_id=req.id, rank=1, kind="reply", text="hello"))
        await s.commit()
    r = await client.delete("/v1/me", headers=bearer(tok))
    assert r.status_code == 204
    async with sessionmaker() as s:
        for model in (User, UserSettings, RefreshToken, SuggestionRequest, Suggestion):
            assert await s.scalar(select(func.count()).select_from(model)) == 0, model
    assert (await client.get("/v1/me", headers=bearer(tok))).status_code == 401


async def test_dev_endpoint_404_in_prod(sessionmaker: Sm) -> None:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    pem = (
        Ed25519PrivateKey.generate()
        .private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        .decode()
    )
    app = create_app(Settings(app_env="prod", jwt_private_key=pem))

    async def override() -> AsyncIterator[AsyncSession]:
        async with sessionmaker() as session:
            yield session

    app.dependency_overrides[get_session] = override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/v1/auth/dev", json={"email": "a@example.com"})
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "not_found"
    # restore ephemeral dev key for subsequent tests
    tokens._keys = None
