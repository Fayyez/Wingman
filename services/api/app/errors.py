"""Uniform JSON error model: {"error": {"code": str, "message": str}}.

Privacy: validation errors never echo request bodies (pydantic's `input`/`ctx` are dropped).
"""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException


class ErrorBody(BaseModel):
    """Machine-readable error code plus a human-readable message."""

    code: str
    message: str


class ErrorResponse(BaseModel):
    """Envelope returned for every non-2xx response."""

    error: ErrorBody


class AppError(Exception):
    """Raise from anywhere to produce a JSON error response."""

    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content=ErrorResponse(error=ErrorBody(code=code, message=message)).model_dump(),
    )


_HTTP_CODES = {
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    429: "rate_limited",
}


async def _app_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)
    return _response(exc.status, exc.code, exc.message)


async def _validation_handler(_request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    # Only field locations and pydantic error types; never the offending input values.
    parts = [
        f"{'.'.join(str(p) for p in e.get('loc', ()))}: {e.get('type', 'invalid')}"
        for e in exc.errors()
    ]
    return _response(422, "validation_error", "Invalid request: " + "; ".join(parts))


async def _http_handler(_request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    code = _HTTP_CODES.get(exc.status_code, "http_error")
    return _response(exc.status_code, code, str(exc.detail))


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _app_error_handler)
    app.add_exception_handler(RequestValidationError, _validation_handler)
    app.add_exception_handler(StarletteHTTPException, _http_handler)
