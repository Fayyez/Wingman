import asyncio
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import (
    DevLoginRequest,
    GoogleLoginRequest,
    MeResponse,
    RefreshRequest,
    TokenResponse,
    UserSettingsOut,
    UserSettingsPatch,
)
from app.auth import google
from app.auth.deps import get_current_user
from app.auth.tokens import TokenPair, issue_token_pair, rotate_refresh_token
from app.db.models import User, UserSettings
from app.db.session import get_session
from app.errors import AppError

router = APIRouter(prefix="/v1", tags=["auth"])
dev_router = APIRouter(prefix="/v1", tags=["auth"])

Session = Annotated[AsyncSession, Depends(get_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]


def _token_response(pair: TokenPair) -> TokenResponse:
    return TokenResponse(
        access_token=pair.access_token,
        refresh_token=pair.refresh_token,
        expires_in=pair.expires_in,
    )


async def _ensure_settings(session: AsyncSession, user: User) -> None:
    if user.settings is None:
        user.settings = UserSettings(user_id=user.id)
        await session.flush()


def _me(user: User) -> MeResponse:
    assert user.settings is not None
    return MeResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        locale=user.locale,
        plan=user.plan,
        settings=UserSettingsOut.model_validate(user.settings),
    )


@router.post("/auth/google", response_model=TokenResponse, operation_id="authGoogle")
async def auth_google(body: GoogleLoginRequest, session: Session) -> TokenResponse:
    """Exchange a Google ID token for an access + refresh token pair."""
    try:
        identity = await asyncio.to_thread(google.verify_google_id_token, body.id_token)
    except ValueError as exc:
        raise AppError("invalid_google_token", "Google ID token rejected", 401) from exc
    user = (
        (
            await session.execute(
                select(User).where(
                    or_(User.google_sub == identity.sub, User.email == identity.email)
                )
            )
        )
        .scalars()
        .first()
    )
    if user is None:
        user = User(email=identity.email, google_sub=identity.sub, display_name=identity.name)
        session.add(user)
        await session.flush()
    else:
        user.google_sub = user.google_sub or identity.sub
        user.display_name = user.display_name or identity.name
        user.deleted_at = None
    await session.refresh(user, ["settings"])
    await _ensure_settings(session, user)
    pair = await issue_token_pair(session, user.id)
    await session.commit()
    return _token_response(pair)


@router.post("/auth/refresh", response_model=TokenResponse, operation_id="authRefresh")
async def auth_refresh(body: RefreshRequest, session: Session) -> TokenResponse:
    """Rotate a refresh token. Reusing an already-rotated token revokes all of the user's tokens."""
    return _token_response(await rotate_refresh_token(session, body.refresh_token))


@dev_router.post("/auth/dev", response_model=TokenResponse, operation_id="authDev")
async def auth_dev(body: DevLoginRequest, session: Session) -> TokenResponse:
    """Dev/test only: log in (creating the user if needed) by email."""
    user = (
        await session.execute(select(User).where(User.email == body.email))
    ).scalar_one_or_none()
    if user is None:
        user = User(email=body.email, display_name=body.email.split("@")[0])
        session.add(user)
        await session.flush()
    await session.refresh(user, ["settings"])
    await _ensure_settings(session, user)
    pair = await issue_token_pair(session, user.id)
    await session.commit()
    return _token_response(pair)


@router.get("/me", response_model=MeResponse, operation_id="getMe")
async def get_me(user: CurrentUser) -> MeResponse:
    """Profile and settings of the authenticated user."""
    return _me(user)


@router.patch("/me/settings", response_model=MeResponse, operation_id="patchMeSettings")
async def patch_settings(
    body: UserSettingsPatch, user: CurrentUser, session: Session
) -> MeResponse:
    """Partially update the user's settings."""
    await _ensure_settings(session, user)
    assert user.settings is not None
    for name in body.model_fields_set:
        setattr(user.settings, name, getattr(body, name))
    user.settings.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(user, ["settings"])
    return _me(user)


@router.delete("/me", status_code=204, operation_id="deleteMe")
async def delete_me(user: CurrentUser, session: Session) -> Response:
    """Hard-delete the account and every row that belongs to it."""
    # Core DELETE: the database cascades (FK ON DELETE CASCADE) to every dependent row.
    await session.execute(delete(User).where(User.id == user.id))
    await session.commit()
    return Response(status_code=204)
