from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../../.env", ".env"), extra="ignore", case_sensitive=False
    )

    app_env: str = "dev"
    database_url: str = "postgresql+asyncpg://wingman:wingman@localhost:5432/wingman"
    redis_url: str = "redis://localhost:6379/0"
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None

    # LLM gateway (M1-04). llm_mode: "auto" = real providers when keys exist, else fake;
    # "fake" = always the deterministic fake provider (tests, offline dev).
    llm_mode: str = "auto"
    llm_routes_file: str | None = None  # default: app/llm/routes.yaml

    # Auth (M1-03). jwt_private_key: Ed25519 PEM; empty => ephemeral key in dev/test only.
    jwt_private_key: str = ""
    google_client_id: str = ""
    sentry_dsn: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
