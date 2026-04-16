from __future__ import annotations

import logging
import os
import sys
from typing import List

from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router as api_router

logger = logging.getLogger("api.trace")


def _parse_origins(raw: str) -> List[str]:
    # Accept comma-separated list. Ignore empties.
    return [o.strip() for o in (raw or "").split(",") if o.strip()]


def _validate_origins(origins: List[str]) -> List[str]:
    if not origins:
        return origins

    for origin in origins:
        if origin == "*":
            raise ValueError("CORS_ALLOW_ORIGINS must not contain '*'")

        parsed = urlparse(origin)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError(
                f"Invalid CORS origin: {origin}. Expected http(s)://host[:port]"
            )

    return origins


def create_app() -> FastAPI:
    app = FastAPI(title="Infinito Deployer API", version="0.1.0")

    origins = _validate_origins(_parse_origins(os.getenv("CORS_ALLOW_ORIGINS", "")))
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    @app.middleware("http")
    async def _trace_requests(request: Request, call_next):
        import time as _time

        path = request.url.path
        tracked = (
            "/credentials" in path
            or "/test-connection" in path
            or "/connection" in path
            or "/primary-domain" in path
        )
        t0 = _time.monotonic()
        if tracked:
            print(f"TRACE: IN {request.method} {path}", file=sys.stderr, flush=True)
        try:
            response = await call_next(request)
        except Exception as exc:
            if tracked:
                dt = _time.monotonic() - t0
                print(
                    f"TRACE: ERR {request.method} {path} dt={dt:.2f}s {exc!r}",
                    file=sys.stderr,
                    flush=True,
                )
            raise
        if tracked:
            dt = _time.monotonic() - t0
            print(
                f"TRACE: OUT {request.method} {path} {response.status_code} dt={dt:.2f}s",
                file=sys.stderr,
                flush=True,
            )
        return response

    app.include_router(api_router, prefix="/api")

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    return app


app = create_app()
