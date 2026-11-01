"""Google ID-token verification (wrapped so tests can monkeypatch it)."""

from dataclasses import dataclass

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from app.settings import get_settings


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str
    name: str | None


def verify_google_id_token(token: str) -> GoogleIdentity:
    """Blocking call (fetches Google certs); raises ValueError if the token is invalid."""
    info = id_token.verify_oauth2_token(  # type: ignore[no-untyped-call]
        token, google_requests.Request(), get_settings().google_client_id or None
    )
    email = info.get("email")
    if not email:
        raise ValueError("Google token has no email")
    return GoogleIdentity(sub=str(info["sub"]), email=str(email), name=info.get("name"))
