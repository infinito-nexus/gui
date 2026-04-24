from __future__ import annotations

import json
import os
import secrets
import time
import ipaddress
from typing import List

from urllib.parse import urlparse

from fastapi import FastAPI
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.auth import resolve_auth_context
from api.routes import router as api_router
from services.audit_logs import AuditLogService
from services.rate_limits import RateLimitService

_CSRF_COOKIE_NAME = "csrf"
_STATE_CHANGING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _parse_origins(raw: str) -> List[str]:
    # Accept comma-separated list. Ignore empties.
    return [o.strip() for o in (raw or "").split(",") if o.strip()]


def _configured_origins() -> List[str]:
    preferred = (os.getenv("ALLOWED_ORIGINS") or "").strip()
    legacy = (os.getenv("CORS_ALLOW_ORIGINS") or "").strip()
    return _parse_origins(preferred or legacy)


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


def _request_body_limit_bytes() -> int:
    raw = (os.getenv("INPUT_MAX_BODY_BYTES") or "").strip()
    try:
        value = int(raw or str(10 * 1024 * 1024))
    except ValueError:
        value = 10 * 1024 * 1024
    return max(value, 1024)


def _request_json_nesting_limit() -> int:
    raw = (os.getenv("INPUT_MAX_NESTING") or "").strip()
    try:
        value = int(raw or "50")
    except ValueError:
        value = 50
    return max(value, 1)


def _json_depth(value: object) -> int:
    if isinstance(value, dict):
        if not value:
            return 1
        return 1 + max(_json_depth(item) for item in value.values())
    if isinstance(value, list):
        if not value:
            return 1
        return 1 + max(_json_depth(item) for item in value)
    return 1


def _is_json_request(request: Request) -> bool:
    content_type = (
        (request.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
    )
    return bool(content_type) and (
        content_type == "application/json" or content_type.endswith("+json")
    )


def _new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def _request_csrf_cookie(request: Request) -> str:
    return (request.cookies.get(_CSRF_COOKIE_NAME) or "").strip()


def _request_csrf_header(request: Request) -> str:
    return (request.headers.get("x-csrf") or "").strip()


def _is_loopback_host(hostname: str | None) -> bool:
    normalized = str(hostname or "").strip().strip("[]").lower()
    if not normalized:
        return False
    if normalized == "localhost":
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False


def _request_external_origins(request: Request) -> list[str]:
    candidates: list[str] = []
    for header in ("origin", "referer"):
        raw = (request.headers.get(header) or "").strip()
        if raw:
            candidates.append(raw)
    forwarded_proto = (
        (request.headers.get("x-forwarded-proto") or "").split(",", 1)[0].strip()
    )
    forwarded_host = (
        (request.headers.get("x-forwarded-host") or "").split(",", 1)[0].strip()
    )
    if forwarded_host:
        scheme = forwarded_proto or "https"
        candidates.append(f"{scheme}://{forwarded_host}")
    return candidates


def _csrf_cookie_secure(request: Request) -> bool:
    for raw_origin in _request_external_origins(request):
        parsed = urlparse(raw_origin)
        if parsed.scheme.lower() == "http" and _is_loopback_host(parsed.hostname):
            return False
    return True


def _referrer_policy_for_request(request: Request | None) -> str:
    path = ((request.url.path if request is not None else "") or "").strip()
    if any(token in path for token in ("/credentials", "/vault/", "/ssh-keys")):
        return "no-referrer"
    return "same-origin"


def _apply_security_headers(response, request: Request | None = None) -> None:
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault(
        "Referrer-Policy", _referrer_policy_for_request(request)
    )


def _set_csrf_cookie(response, request: Request, token: str) -> None:
    response.set_cookie(
        key=_CSRF_COOKIE_NAME,
        value=token,
        secure=_csrf_cookie_secure(request),
        httponly=False,
        samesite="strict",
        path="/",
    )


def create_app() -> FastAPI:
    app = FastAPI(title="Infinito Deployer API", version="0.1.0")
    audit_logs = AuditLogService()
    app.state.rate_limits = RateLimitService()

    origins = _validate_origins(_configured_origins())
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(api_router, prefix="/api")

    @app.middleware("http")
    async def audit_requests(request: Request, call_next):
        started_at = time.perf_counter()
        response = None
        status_code = 500
        auth_context = resolve_auth_context(request)
        csrf_cookie = _request_csrf_cookie(request)
        try:
            if (
                not auth_context.proxy_enabled
                and request.method in _STATE_CHANGING_METHODS
            ):
                csrf_header = _request_csrf_header(request)
                if not csrf_cookie or not csrf_header or csrf_cookie != csrf_header:
                    response = JSONResponse(
                        status_code=403,
                        content={"detail": "CSRF token mismatch"},
                    )
                    if not csrf_cookie:
                        _set_csrf_cookie(response, request, _new_csrf_token())
                    _apply_security_headers(response, request)
                    status_code = int(response.status_code)
                    return response

            if request.method in {
                "POST",
                "PUT",
                "PATCH",
                "DELETE",
            } and _is_json_request(request):
                body_limit = _request_body_limit_bytes()
                raw_length = (request.headers.get("content-length") or "").strip()
                if raw_length:
                    try:
                        declared_length = int(raw_length)
                    except ValueError:
                        declared_length = 0
                    if declared_length > body_limit:
                        response = JSONResponse(
                            status_code=413,
                            content={
                                "detail": "request body exceeds INPUT_MAX_BODY_BYTES"
                            },
                        )
                        if not auth_context.proxy_enabled and not csrf_cookie:
                            _set_csrf_cookie(response, request, _new_csrf_token())
                        _apply_security_headers(response, request)
                        status_code = int(response.status_code)
                        return response

                body = await request.body()
                if len(body) > body_limit:
                    response = JSONResponse(
                        status_code=413,
                        content={"detail": "request body exceeds INPUT_MAX_BODY_BYTES"},
                    )
                    if not auth_context.proxy_enabled and not csrf_cookie:
                        _set_csrf_cookie(response, request, _new_csrf_token())
                    _apply_security_headers(response, request)
                    status_code = int(response.status_code)
                    return response

                if body:
                    try:
                        payload = json.loads(body)
                    except json.JSONDecodeError:
                        payload = None
                    if (
                        payload is not None
                        and _json_depth(payload) > _request_json_nesting_limit()
                    ):
                        response = JSONResponse(
                            status_code=400,
                            content={
                                "detail": "request body exceeds INPUT_MAX_NESTING"
                            },
                        )
                        if not auth_context.proxy_enabled and not csrf_cookie:
                            _set_csrf_cookie(response, request, _new_csrf_token())
                        _apply_security_headers(response, request)
                        status_code = int(response.status_code)
                        return response

            response = await call_next(request)
            status_code = int(getattr(response, "status_code", 500) or 500)
            if not auth_context.proxy_enabled and not csrf_cookie:
                _set_csrf_cookie(response, request, _new_csrf_token())
            _apply_security_headers(response, request)
            return response
        finally:
            duration_ms = int((time.perf_counter() - started_at) * 1000)
            event = audit_logs.build_event(
                request=request,
                status=status_code,
                duration_ms=duration_ms,
            )
            if event is not None:
                audit_logs.enqueue_event(event)

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    return app


app = create_app()
