"""Request/response schemas. These drive the OpenAPI contract and the generated TS client."""

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Tone = Literal["chill", "playful", "flirty", "sweet", "sincere", "funny", "apologetic", "confident"]
Objective = Literal[
    "keep_going",
    "build_rapport",
    "deepen",
    "flirt_up",
    "ask_out",
    "recover",
    "slow_down",
    "end_gracefully",
]
LangPref = Literal["auto", "more_urdu_hindi", "more_english"]

Email = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=320, pattern=r"^[^@\s]+@[^@\s]+$")
]


class GoogleLoginRequest(BaseModel):
    """Google ID token obtained on the client (e.g. via chrome.identity)."""

    id_token: str = Field(min_length=1)


class RefreshRequest(BaseModel):
    """Refresh token previously issued by this API."""

    refresh_token: str = Field(min_length=1)


class DevLoginRequest(BaseModel):
    """Dev/test-only login by email (endpoint absent in production)."""

    email: Email


class TokenResponse(BaseModel):
    """Access + refresh token pair. `expires_in` is the access token lifetime in seconds."""

    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int


class UserSettingsOut(BaseModel):
    """The user's saved defaults and consent toggles."""

    model_config = ConfigDict(from_attributes=True)

    default_tone: Tone | None
    default_objective: Objective | None
    lang_pref: LangPref
    emoji_level: int
    auto_suggest: bool
    data_donation: bool
    style_learning: bool


class UserSettingsPatch(BaseModel):
    """Partial update of user settings; omitted fields are unchanged."""

    model_config = ConfigDict(extra="forbid")

    default_tone: Tone | None = None
    default_objective: Objective | None = None
    lang_pref: LangPref | None = None
    emoji_level: Annotated[int, Field(ge=0, le=3)] | None = None
    auto_suggest: bool | None = None
    data_donation: bool | None = None
    style_learning: bool | None = None

    @model_validator(mode="after")
    def _no_explicit_null(self) -> "UserSettingsPatch":
        """Only default_tone / default_objective may be reset to null."""
        for name in self.model_fields_set - {"default_tone", "default_objective"}:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class MeResponse(BaseModel):
    """The authenticated user's profile and settings."""

    id: uuid.UUID
    email: str
    display_name: str | None
    locale: str | None
    plan: str
    settings: UserSettingsOut
