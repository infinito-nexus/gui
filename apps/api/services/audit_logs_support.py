from __future__ import annotations

import csv
import io
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Sequence
from urllib.parse import quote_plus

from fastapi import Request

from api.auth import resolve_auth_context
from services.job_runner.secrets import mask_secrets

try:
    import psycopg  # type: ignore[import-not-found]
except Exception:  # pragma: no cover - optional in lightweight unit runs
    psycopg = None


DEFAULT_RETENTION_DAYS = 180
DEFAULT_LOG_MODE = "all"
GLOBAL_WORKSPACE_ID = "__global__"
HEALTH_PATHS = frozenset({"/health", "/api/health"})
AUTH_PATH_TOKENS = ("/auth", "/session", "/login", "/logout", "/oauth2")
REQUEST_ID_HEADERS = ("x-request-id", "x-correlation-id")


def trim(value: str | None) -> str:
    return str(value or "").strip()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def isoformat_z(value: datetime | str | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        trimmed = trim(value)
        if trimmed.endswith("+00:00"):
            return f"{trimmed[:-6]}Z"
        return trimmed or None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def postgres_dsn_from_env() -> str | None:
    for key in (
        "AUDIT_DATABASE_URL",
        "DATABASE_URL",
        "POSTGRES_DSN",
        "POSTGRES_URL",
    ):
        raw = trim(os.getenv(key))
        if raw:
            return raw

    host = trim(os.getenv("POSTGRES_HOST"))
    db = trim(os.getenv("POSTGRES_DB"))
    if not host or not db:
        return None

    port = trim(os.getenv("POSTGRES_PORT")) or "5432"
    user = trim(os.getenv("POSTGRES_USER"))
    password = os.getenv("POSTGRES_PASSWORD") or ""

    auth = quote_plus(user) if user else ""
    if password:
        auth = f"{auth}:{quote_plus(password)}" if auth else f":{quote_plus(password)}"
    if auth:
        auth = f"{auth}@"

    return f"postgresql://{auth}{host}:{port}/{db}"


def canonical_client_ip(request: Request) -> str:
    forwarded = trim(request.headers.get("x-forwarded-for"))
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    if request.client and request.client.host:
        return str(request.client.host)
    return "unknown"


def actor_identity(request: Request) -> str:
    ctx = resolve_auth_context(request)
    return trim(ctx.user_id) or trim(ctx.email) or "anonymous"


def request_id_from_headers(request: Request) -> str | None:
    for header in REQUEST_ID_HEADERS:
        value = trim(request.headers.get(header))
        if value:
            return value
    return None


def mask_audit_text(value: str | None) -> str | None:
    text = trim(value)
    if not text:
        return None
    return trim(mask_secrets(text, [])) or None


def storage_workspace_id(value: str | None) -> str:
    return trim(value) or GLOBAL_WORKSPACE_ID


def public_workspace_id(value: str | None) -> str | None:
    normalized = trim(value)
    if not normalized or normalized == GLOBAL_WORKSPACE_ID:
        return None
    return normalized


@dataclass(frozen=True)
class AuditLogConfig:
    workspace_id: str
    retention_days: int = DEFAULT_RETENTION_DAYS
    mode: str = DEFAULT_LOG_MODE
    exclude_health_endpoints: bool = False

    def as_dict(self) -> Dict[str, Any]:
        return {
            "workspace_id": self.workspace_id,
            "retention_days": self.retention_days,
            "mode": self.mode,
            "exclude_health_endpoints": self.exclude_health_endpoints,
        }


def row_to_entry(row: Sequence[Any]) -> dict[str, Any]:
    timestamp = row[1]
    return {
        "id": int(row[0]),
        "timestamp": isoformat_z(timestamp),
        "workspace_id": public_workspace_id(row[2]),
        "user": trim(row[3]) or "anonymous",
        "method": trim(row[4]).upper(),
        "path": trim(row[5]) or "/",
        "status": int(row[6]),
        "duration_ms": int(row[7]),
        "ip": trim(row[8]) or "unknown",
        "request_id": trim(row[9]) or None,
        "user_agent": trim(row[10]) or None,
    }


def encode_jsonl(rows: Iterable[dict[str, Any]]) -> bytes:
    out = io.StringIO()
    for row in rows:
        payload = dict(row)
        payload["timestamp"] = isoformat_z(payload.get("timestamp"))
        out.write(json.dumps(payload, ensure_ascii=False))
        out.write("\n")
    return out.getvalue().encode("utf-8")


def encode_csv(rows: Iterable[dict[str, Any]]) -> bytes:
    out = io.StringIO()
    writer = csv.DictWriter(
        out,
        fieldnames=[
            "id",
            "timestamp",
            "workspace_id",
            "user",
            "method",
            "path",
            "status",
            "duration_ms",
            "ip",
            "request_id",
            "user_agent",
        ],
    )
    writer.writeheader()
    for row in rows:
        payload = dict(row)
        payload["timestamp"] = isoformat_z(payload.get("timestamp"))
        writer.writerow(payload)
    return out.getvalue().encode("utf-8")
