from fastapi import FastAPI

from app import __version__
from app.api.auth import dev_router
from app.api.auth import router as auth_router
from app.api.openapi import install_openapi
from app.api.suggest import router as suggest_router
from app.auth.tokens import init_keys
from app.errors import register_error_handlers
from app.logging import configure_logging
from app.observability import init_sentry
from app.settings import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging()
    init_sentry(settings.sentry_dsn, settings.app_env)
    init_keys(settings)
    app = FastAPI(title="Wingman API", version=__version__)
    register_error_handlers(app)

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    app.include_router(auth_router)
    if settings.app_env in ("dev", "test"):
        app.include_router(dev_router)
    app.include_router(suggest_router)
    install_openapi(app)

    return app
