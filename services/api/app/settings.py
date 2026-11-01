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


@lru_cache
def get_settings() -> Settings:
    return Settings()
