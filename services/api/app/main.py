from fastapi import FastAPI

from app import __version__
from app.logging import configure_logging


def create_app() -> FastAPI:
    configure_logging()
    app = FastAPI(title="Wingman API", version=__version__)

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return app
