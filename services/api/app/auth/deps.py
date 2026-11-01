from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.tokens import decode_access_token
from app.db.models import User
from app.db.session import get_session
from app.errors import AppError

_bearer = HTTPBearer(auto_error=False, description="Wingman access JWT")


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    if credentials is None:
        raise AppError("unauthorized", "Missing bearer token", 401)
    user = await session.get(User, decode_access_token(credentials.credentials))
    if user is None or user.deleted_at is not None:
        raise AppError("unauthorized", "Unknown user", 401)
    return user
