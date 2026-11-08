"""Access JWTs (EdDSA) and rotating refresh tokens (stored only as sha256 hashes)."""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt
import structlog
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import RefreshToken
from app.errors import AppError
from app.settings import Settings, get_settings

log = structlog.get_logger()

ISSUER = "wingman"
ACCESS_TTL = timedelta(minutes=15)
REFRESH_TTL = timedelta(days=30)


@dataclass(frozen=True)
class Keys:
    private: Ed25519PrivateKey
    public: Ed25519PublicKey


_keys: Keys | None = None


def _from_private(key: Ed25519PrivateKey) -> Keys:
    return Keys(private=key, public=key.public_key())


def init_keys(settings: Settings) -> Keys:
    """Load the signing key from settings, or create an ephemeral one in dev/test."""
    global _keys
    pem = settings.jwt_private_key.strip().replace("\\n", "\n")
    if pem:
        loaded = serialization.load_pem_private_key(pem.encode(), password=None)
        if not isinstance(loaded, Ed25519PrivateKey):
            raise RuntimeError("jwt_private_key must be an Ed25519 PEM private key")
        _keys = _from_private(loaded)
    elif settings.app_env in ("dev", "test"):
        if _keys is None:
            log.warning("jwt_private_key_missing_using_ephemeral_key", app_env=settings.app_env)
            _keys = _from_private(Ed25519PrivateKey.generate())
    else:
        raise RuntimeError("jwt_private_key is required when app_env is not dev/test")
    return _keys


def get_keys() -> Keys:
    return _keys if _keys is not None else init_keys(get_settings())


def create_access_token(user_id: uuid.UUID, now: datetime | None = None) -> str:
    issued = now or datetime.now(UTC)
    claims = {
        "sub": str(user_id),
        "iat": issued,
        "exp": issued + ACCESS_TTL,
        "typ": "access",
        "iss": ISSUER,
    }
    return jwt.encode(claims, get_keys().private, algorithm="EdDSA")


def decode_access_token(token: str) -> uuid.UUID:
    """Return the user id or raise AppError(401)."""
    try:
        claims = jwt.decode(
            token,
            get_keys().public,
            algorithms=["EdDSA"],
            issuer=ISSUER,
            options={"require": ["sub", "iat", "exp", "iss"]},
        )
        if claims.get("typ") != "access":
            raise jwt.InvalidTokenError("wrong token type")
        return uuid.UUID(str(claims["sub"]))
    except (jwt.PyJWTError, ValueError) as exc:
        raise AppError("unauthorized", "Invalid or expired access token", 401) from exc


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str
    expires_in: int


async def _new_refresh_row(
    session: AsyncSession, user_id: uuid.UUID, rotated_from: uuid.UUID | None
) -> str:
    raw = secrets.token_urlsafe(32)
    session.add(
        RefreshToken(
            user_id=user_id,
            token_hash=hash_refresh_token(raw),
            expires_at=datetime.now(UTC) + REFRESH_TTL,
            rotated_from=rotated_from,
        )
    )
    await session.flush()
    return raw


async def issue_token_pair(
    session: AsyncSession, user_id: uuid.UUID, rotated_from: uuid.UUID | None = None
) -> TokenPair:
    refresh = await _new_refresh_row(session, user_id, rotated_from)
    return TokenPair(
        access_token=create_access_token(user_id),
        refresh_token=refresh,
        expires_in=int(ACCESS_TTL.total_seconds()),
    )


async def rotate_refresh_token(session: AsyncSession, raw_token: str) -> TokenPair:
    """Exchange a refresh token for a new pair. Reuse of a revoked token revokes the chain."""
    row = (
        await session.execute(
            select(RefreshToken)
            .where(RefreshToken.token_hash == hash_refresh_token(raw_token))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        raise AppError("unauthorized", "Invalid refresh token", 401)
    now = datetime.now(UTC)
    if row.revoked_at is not None:
        await session.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == row.user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        await session.commit()
        log.warning("refresh_token_reuse_detected", user_id=str(row.user_id))
        raise AppError("unauthorized", "Refresh token reuse detected", 401)
    if row.expires_at <= now:
        raise AppError("unauthorized", "Refresh token expired", 401)
    row.revoked_at = now
    pair = await issue_token_pair(session, row.user_id, rotated_from=row.id)
    await session.commit()
    return pair
