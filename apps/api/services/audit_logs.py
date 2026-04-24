from __future__ import annotations

import csv
import io
import json
import os
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from queue import Empty, Full, Queue
from typing import Any, Dict, Iterable, Sequence
from urllib.parse import quote_plus

from fastapi import HTTPException, Request

from api.auth import resolve_auth_context
from services.job_runner.secrets import mask_secrets

try:
    import psycopg  # type: ignore[import-not-found]
except Exception:  # pragma: no cover - optional in lightweight unit runs
    psycopg = None


DEFAULT_RETENTION_DAYS = 180
DEFAULT_LOG_MODE = "all"
_GLOBAL_WORKSPACE_ID = "__global__"
_HEALTH_PATHS = frozenset({"/health", "/api/health"})
_AUTH_PATH_TOKENS = ("/auth", "/session", "/login", "/logout", "/oauth2")
_REQUEST_ID_HEADERS = ("x-request-id", "x-correlation-id")


def _trim(value: str | None) -> str:
    return str(value or "").strip()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _isoformat_z(value: datetime | str | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        trimmed = _trim(value)
        if trimmed.endswith("+00:00"):
            return f"{trimmed[:-6]}Z"
        return trimmed or None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _postgres_dsn_from_env() -> str | None:
    for key in (
        "AUDIT_DATABASE_URL",
        "DATABASE_URL",
        "POSTGRES_DSN",
        "POSTGRES_URL",
    ):
        raw = _trim(os.getenv(key))
        if raw:
            return raw

    host = _trim(os.getenv("POSTGRES_HOST"))
    db = _trim(os.getenv("POSTGRES_DB"))
    if not host or not db:
        return None

    port = _trim(os.getenv("POSTGRES_PORT")) or "5432"
    user = _trim(os.getenv("POSTGRES_USER"))
    password = os.getenv("POSTGRES_PASSWORD") or ""

    auth = quote_plus(user) if user else ""
    if password:
        auth = f"{auth}:{quote_plus(password)}" if auth else f":{quote_plus(password)}"
    if auth:
        auth = f"{auth}@"

    return f"postgresql://{auth}{host}:{port}/{db}"


def canonical_client_ip(request: Request) -> str:
    forwarded = _trim(request.headers.get("x-forwarded-for"))
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    if request.client and request.client.host:
        return str(request.client.host)
    return "unknown"


def actor_identity(request: Request) -> str:
    ctx = resolve_auth_context(request)
    return _trim(ctx.user_id) or _trim(ctx.email) or "anonymous"


def request_id_from_headers(request: Request) -> str | None:
    for header in _REQUEST_ID_HEADERS:
        value = _trim(request.headers.get(header))
        if value:
            return value
    return None


def _mask_audit_text(value: str | None) -> str | None:
    text = _trim(value)
    if not text:
        return None
    return _trim(mask_secrets(text, [])) or None


def _storage_workspace_id(value: str | None) -> str:
    return _trim(value) or _GLOBAL_WORKSPACE_ID


def _public_workspace_id(value: str | None) -> str | None:
    normalized = _trim(value)
    if not normalized or normalized == _GLOBAL_WORKSPACE_ID:
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


class AuditLogService:
    def __init__(self) -> None:
        self._dsn = _postgres_dsn_from_env()
        self._schema_ready = False
        self._schema_lock = threading.Lock()
        self._config_cache: dict[str, AuditLogConfig] = {}
        self._config_lock = threading.Lock()
        self._queue: Queue[dict[str, Any]] = Queue(maxsize=4096)
        self._worker_started = False
        self._cleanup_started = False
        self._threads_lock = threading.Lock()
        self._start_threads_if_possible()

    def _start_threads_if_possible(self) -> None:
        if not self.is_enabled():
            return
        with self._threads_lock:
            if not self._worker_started:
                threading.Thread(target=self._worker_loop, daemon=True).start()
                self._worker_started = True
            if not self._cleanup_started:
                threading.Thread(target=self._cleanup_loop, daemon=True).start()
                self._cleanup_started = True

    def is_enabled(self) -> bool:
        return bool(self._dsn and psycopg is not None)

    def _require_enabled(self) -> str:
        if not self._dsn:
            raise HTTPException(
                status_code=503,
                detail="audit log database is not configured (missing DATABASE_URL/POSTGRES_*)",
            )
        if psycopg is None:
            raise HTTPException(
                status_code=503,
                detail="audit log database driver not installed (missing psycopg)",
            )
        return self._dsn

    def _ensure_schema(self, conn: Any) -> None:
        if self._schema_ready:
            return
        with self._schema_lock:
            if self._schema_ready:
                return
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS audit_log_config (
                      workspace_id TEXT PRIMARY KEY,
                      retention_days INTEGER NOT NULL DEFAULT 180,
                      mode TEXT NOT NULL DEFAULT 'all',
                      exclude_health_endpoints BOOLEAN NOT NULL DEFAULT FALSE,
                      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS audit_log_event (
                      id BIGSERIAL PRIMARY KEY,
                      timestamp TIMESTAMPTZ NOT NULL,
                      workspace_id TEXT NOT NULL DEFAULT '__global__',
                      actor TEXT NOT NULL,
                      method TEXT NOT NULL,
                      path TEXT NOT NULL,
                      status INTEGER NOT NULL,
                      duration_ms INTEGER NOT NULL,
                      client_ip TEXT NOT NULL,
                      request_id TEXT NULL,
                      user_agent TEXT NULL
                    );
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_audit_log_event_workspace_timestamp
                    ON audit_log_event (workspace_id, timestamp DESC);
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_audit_log_event_timestamp
                    ON audit_log_event (timestamp DESC);
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_audit_log_event_method_status
                    ON audit_log_event (method, status);
                    """
                )
                cur.execute(
                    """
                    UPDATE audit_log_event
                    SET workspace_id = %s
                    WHERE workspace_id IS NULL OR workspace_id = '';
                    """,
                    (_GLOBAL_WORKSPACE_ID,),
                )
                cur.execute(
                    """
                    ALTER TABLE audit_log_event
                    ALTER COLUMN workspace_id SET DEFAULT '__global__';
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE audit_log_event
                    ALTER COLUMN workspace_id SET NOT NULL;
                    """
                )
            conn.commit()
            self._schema_ready = True

    def _connect(self):
        dsn = self._require_enabled()
        conn = psycopg.connect(dsn)
        self._ensure_schema(conn)
        return conn

    def get_config(self, workspace_id: str) -> AuditLogConfig:
        workspace_key = _trim(workspace_id)
        if not workspace_key:
            raise HTTPException(status_code=400, detail="workspace_id is required")

        with self._config_lock:
            cached = self._config_cache.get(workspace_key)
        if cached is not None:
            return cached

        config = AuditLogConfig(workspace_id=workspace_key)
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT retention_days, mode, exclude_health_endpoints
                    FROM audit_log_config
                    WHERE workspace_id = %s
                    LIMIT 1;
                    """,
                    (workspace_key,),
                )
                row = cur.fetchone()
        if row:
            config = AuditLogConfig(
                workspace_id=workspace_key,
                retention_days=max(int(row[0] or DEFAULT_RETENTION_DAYS), 1),
                mode=_trim(row[1]) or DEFAULT_LOG_MODE,
                exclude_health_endpoints=bool(row[2]),
            )

        with self._config_lock:
            self._config_cache[workspace_key] = config
        return config

    def update_config(
        self,
        workspace_id: str,
        *,
        retention_days: int,
        mode: str,
        exclude_health_endpoints: bool,
    ) -> AuditLogConfig:
        workspace_key = _trim(workspace_id)
        if not workspace_key:
            raise HTTPException(status_code=400, detail="workspace_id is required")
        if retention_days < 1:
            raise HTTPException(status_code=400, detail="retention_days must be >= 1")

        allowed_modes = {
            "all",
            "writes-only",
            "auth-only",
            "deployment-only",
            "errors-only",
        }
        if mode not in allowed_modes:
            raise HTTPException(status_code=400, detail="unsupported audit log mode")

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO audit_log_config (
                      workspace_id,
                      retention_days,
                      mode,
                      exclude_health_endpoints
                    )
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (workspace_id)
                    DO UPDATE SET
                      retention_days = EXCLUDED.retention_days,
                      mode = EXCLUDED.mode,
                      exclude_health_endpoints = EXCLUDED.exclude_health_endpoints,
                      updated_at = NOW()
                    RETURNING retention_days, mode, exclude_health_endpoints;
                    """,
                    (
                        workspace_key,
                        int(retention_days),
                        mode,
                        bool(exclude_health_endpoints),
                    ),
                )
                row = cur.fetchone()
            conn.commit()

        config = AuditLogConfig(
            workspace_id=workspace_key,
            retention_days=int(row[0] or retention_days),
            mode=_trim(row[1]) or mode,
            exclude_health_endpoints=bool(row[2]),
        )
        with self._config_lock:
            self._config_cache[workspace_key] = config
        return config

    def should_log_event(
        self,
        *,
        workspace_id: str | None,
        method: str,
        path: str,
        status: int,
    ) -> bool:
        workspace_key = _trim(workspace_id) or None
        config = (
            self.get_config(workspace_key)
            if workspace_key and self.is_enabled()
            else AuditLogConfig(workspace_id=workspace_key or "")
        )

        normalized_path = _trim(path) or "/"
        normalized_method = (_trim(method) or "GET").upper()

        if config.exclude_health_endpoints and normalized_path in _HEALTH_PATHS:
            return False

        mode = config.mode or DEFAULT_LOG_MODE
        if mode == "all":
            return True
        if mode == "writes-only":
            return normalized_method in {"POST", "PUT", "PATCH", "DELETE"}
        if mode == "auth-only":
            return any(token in normalized_path for token in _AUTH_PATH_TOKENS)
        if mode == "deployment-only":
            return normalized_path.startswith("/api/deployments")
        if mode == "errors-only":
            return int(status) >= 400
        return True

    def enqueue_event(self, event: dict[str, Any]) -> None:
        if not self.is_enabled():
            return
        self._start_threads_if_possible()
        try:
            self._queue.put_nowait(event)
        except Full:
            threading.Thread(
                target=self._insert_batch, args=([event],), daemon=True
            ).start()

    def enqueue_system_event(
        self,
        *,
        path: str,
        workspace_id: str | None = None,
        status: int = 200,
        actor: str = "runner-manager",
        client_ip: str = "runner-manager",
        duration_ms: int = 0,
        request_id: str | None = None,
        user_agent: str | None = "runner-manager",
    ) -> None:
        if not self.is_enabled():
            return
        event = {
            "timestamp": _isoformat_z(_utc_now()),
            "workspace_id": _storage_workspace_id(workspace_id),
            "actor": _trim(actor) or "runner-manager",
            "method": "SYSTEM",
            "path": _trim(path) or "/internal/system",
            "status": int(status),
            "duration_ms": max(int(duration_ms), 0),
            "client_ip": _trim(client_ip) or "runner-manager",
            "request_id": _mask_audit_text(request_id),
            "user_agent": _mask_audit_text(user_agent),
        }
        self.enqueue_event(event)

    def build_event(
        self,
        *,
        request: Request,
        status: int,
        duration_ms: int,
    ) -> dict[str, Any] | None:
        workspace_id = _trim(getattr(request.state, "audit_workspace_id", None)) or None
        path = _trim(request.url.path) or "/"
        method = (_trim(request.method) or "GET").upper()
        if not self.should_log_event(
            workspace_id=workspace_id,
            method=method,
            path=path,
            status=status,
        ):
            return None

        user_agent = _trim(request.headers.get("user-agent")) or None
        return {
            "timestamp": _utc_now(),
            "workspace_id": workspace_id,
            "actor": _mask_audit_text(actor_identity(request)) or "anonymous",
            "method": method,
            "path": path,
            "status": int(status),
            "duration_ms": max(int(duration_ms), 0),
            "client_ip": canonical_client_ip(request),
            "request_id": _mask_audit_text(request_id_from_headers(request)),
            "user_agent": _mask_audit_text(user_agent),
        }

    def list_entries(
        self,
        workspace_id: str,
        *,
        page: int,
        page_size: int,
        from_ts: datetime | None,
        to_ts: datetime | None,
        user: str | None,
        ip: str | None,
        q: str | None,
        status: int | None,
        method: str | None,
    ) -> dict[str, Any]:
        workspace_key = _trim(workspace_id)
        if not workspace_key:
            raise HTTPException(status_code=400, detail="workspace_id is required")

        page = max(int(page), 1)
        page_size = min(max(int(page_size), 1), 200)

        where_sql, params = self._build_filter_clause(
            workspace_id=workspace_key,
            from_ts=from_ts,
            to_ts=to_ts,
            user=user,
            ip=ip,
            q=q,
            status=status,
            method=method,
        )

        limit = page_size
        offset = (page - 1) * page_size

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT COUNT(*)
                    FROM audit_log_event
                    WHERE {where_sql};
                    """,
                    params,
                )
                total_row = cur.fetchone()
                cur.execute(
                    f"""
                    SELECT
                      id,
                      timestamp,
                      workspace_id,
                      actor,
                      method,
                      path,
                      status,
                      duration_ms,
                      client_ip,
                      request_id,
                      user_agent
                    FROM audit_log_event
                    WHERE {where_sql}
                    ORDER BY timestamp DESC, id DESC
                    LIMIT %s OFFSET %s;
                    """,
                    [*params, limit, offset],
                )
                rows = cur.fetchall() or []

        return {
            "entries": [self._row_to_entry(row) for row in rows],
            "page": page,
            "page_size": page_size,
            "total": int((total_row or [0])[0] or 0),
        }

    def export_entries(
        self,
        workspace_id: str,
        *,
        fmt: str,
        zipped: bool,
        from_ts: datetime | None,
        to_ts: datetime | None,
        user: str | None,
        ip: str | None,
        q: str | None,
        status: int | None,
        method: str | None,
    ) -> dict[str, Any]:
        workspace_key = _trim(workspace_id)
        if not workspace_key:
            raise HTTPException(status_code=400, detail="workspace_id is required")
        normalized_format = _trim(fmt).lower() or "jsonl"
        if normalized_format not in {"jsonl", "csv"}:
            raise HTTPException(status_code=400, detail="unsupported export format")

        rows = self._fetch_entries_for_export(
            workspace_key,
            from_ts=from_ts,
            to_ts=to_ts,
            user=user,
            ip=ip,
            q=q,
            status=status,
            method=method,
        )
        payload = (
            self._encode_jsonl(rows)
            if normalized_format == "jsonl"
            else self._encode_csv(rows)
        )
        file_ext = normalized_format
        file_name = f"audit-log-{workspace_key}.{file_ext}"
        media_type = (
            "application/x-ndjson"
            if normalized_format == "jsonl"
            else "text/csv; charset=utf-8"
        )

        if zipped:
            import zipfile

            archive_name = f"audit-log-{workspace_key}.zip"
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(
                zip_buffer,
                mode="w",
                compression=zipfile.ZIP_DEFLATED,
            ) as zf:
                zf.writestr(file_name, payload)
            return {
                "body": zip_buffer.getvalue(),
                "filename": archive_name,
                "media_type": "application/zip",
            }

        return {
            "body": payload,
            "filename": file_name,
            "media_type": media_type,
        }

    def stream_export_entries(
        self,
        workspace_id: str,
        *,
        fmt: str,
        zipped: bool,
        from_ts: datetime | None,
        to_ts: datetime | None,
        user: str | None,
        ip: str | None,
        q: str | None,
        status: int | None,
        method: str | None,
    ) -> dict[str, Any]:
        workspace_key = _trim(workspace_id)
        if not workspace_key:
            raise HTTPException(status_code=400, detail="workspace_id is required")
        normalized_format = _trim(fmt).lower() or "jsonl"
        if normalized_format not in {"jsonl", "csv"}:
            raise HTTPException(status_code=400, detail="unsupported export format")

        file_ext = normalized_format
        filename = f"audit-log-{workspace_key}.{file_ext}"
        media_type = (
            "application/x-ndjson"
            if normalized_format == "jsonl"
            else "text/csv; charset=utf-8"
        )
        if zipped:
            filename = f"audit-log-{workspace_key}.zip"
            media_type = "application/zip"

        chunk_queue: Queue[bytes | Exception | None] = Queue(maxsize=4)

        def worker() -> None:
            try:
                result = self.export_entries(
                    workspace_key,
                    fmt=normalized_format,
                    zipped=zipped,
                    from_ts=from_ts,
                    to_ts=to_ts,
                    user=user,
                    ip=ip,
                    q=q,
                    status=status,
                    method=method,
                )
                chunk_queue.put(bytes(result["body"]))
            except Exception as exc:  # pragma: no cover - exercised via iterator
                chunk_queue.put(exc)
            finally:
                chunk_queue.put(None)

        threading.Thread(target=worker, daemon=True).start()

        def body_iter() -> Iterable[bytes]:
            while True:
                item = chunk_queue.get()
                if item is None:
                    break
                if isinstance(item, Exception):
                    raise item
                yield item

        return {
            "body": body_iter(),
            "filename": filename,
            "media_type": media_type,
        }

    def cleanup_expired_entries(self) -> int:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM audit_log_event AS event
                    WHERE event.timestamp < NOW() - (
                      COALESCE(
                        (
                          SELECT config.retention_days
                          FROM audit_log_config AS config
                          WHERE config.workspace_id = event.workspace_id
                        ),
                        %s
                      ) * INTERVAL '1 day'
                    );
                    """,
                    (DEFAULT_RETENTION_DAYS,),
                )
                deleted = int(cur.rowcount or 0)
            conn.commit()
        return deleted

    def _fetch_entries_for_export(
        self,
        workspace_id: str,
        *,
        from_ts: datetime | None,
        to_ts: datetime | None,
        user: str | None,
        ip: str | None,
        q: str | None,
        status: int | None,
        method: str | None,
    ) -> list[dict[str, Any]]:
        where_sql, params = self._build_filter_clause(
            workspace_id=workspace_id,
            from_ts=from_ts,
            to_ts=to_ts,
            user=user,
            ip=ip,
            q=q,
            status=status,
            method=method,
        )
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT
                      id,
                      timestamp,
                      workspace_id,
                      actor,
                      method,
                      path,
                      status,
                      duration_ms,
                      client_ip,
                      request_id,
                      user_agent
                    FROM audit_log_event
                    WHERE {where_sql}
                    ORDER BY timestamp DESC, id DESC;
                    """,
                    params,
                )
                rows = cur.fetchall() or []
        return [self._row_to_entry(row) for row in rows]

    def _build_filter_clause(
        self,
        *,
        workspace_id: str,
        from_ts: datetime | None,
        to_ts: datetime | None,
        user: str | None,
        ip: str | None,
        q: str | None,
        status: int | None,
        method: str | None,
    ) -> tuple[str, list[Any]]:
        clauses = ["workspace_id = %s"]
        params: list[Any] = [workspace_id]

        if from_ts is not None:
            clauses.append("timestamp >= %s")
            params.append(from_ts)
        if to_ts is not None:
            clauses.append("timestamp <= %s")
            params.append(to_ts)
        if _trim(user):
            clauses.append("actor = %s")
            params.append(_trim(user))
        if _trim(ip):
            clauses.append("client_ip = %s")
            params.append(_trim(ip))
        if status is not None:
            clauses.append("status = %s")
            params.append(int(status))
        if _trim(method):
            clauses.append("method = %s")
            params.append(_trim(method).upper())
        if _trim(q):
            params.append(f"%{_trim(q)}%")
            clauses.append(
                "("
                "path ILIKE %s OR "
                "actor ILIKE %s OR "
                "COALESCE(user_agent, '') ILIKE %s OR "
                "COALESCE(request_id, '') ILIKE %s"
                ")"
            )
            params.extend([params[-1], params[-1], params[-1]])

        return " AND ".join(clauses), params

    def _row_to_entry(self, row: Sequence[Any]) -> dict[str, Any]:
        timestamp = row[1]
        return {
            "id": int(row[0]),
            "timestamp": _isoformat_z(timestamp),
            "workspace_id": _public_workspace_id(row[2]),
            "user": _trim(row[3]) or "anonymous",
            "method": _trim(row[4]).upper(),
            "path": _trim(row[5]) or "/",
            "status": int(row[6]),
            "duration_ms": int(row[7]),
            "ip": _trim(row[8]) or "unknown",
            "request_id": _trim(row[9]) or None,
            "user_agent": _trim(row[10]) or None,
        }

    def _encode_jsonl(self, rows: Iterable[dict[str, Any]]) -> bytes:
        out = io.StringIO()
        for row in rows:
            payload = dict(row)
            payload["timestamp"] = _isoformat_z(payload.get("timestamp"))
            out.write(json.dumps(payload, ensure_ascii=False))
            out.write("\n")
        return out.getvalue().encode("utf-8")

    def _encode_csv(self, rows: Iterable[dict[str, Any]]) -> bytes:
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
            payload["timestamp"] = _isoformat_z(payload.get("timestamp"))
            writer.writerow(payload)
        return out.getvalue().encode("utf-8")

    def _insert_batch(self, batch: Sequence[dict[str, Any]]) -> None:
        if not batch:
            return
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.executemany(
                        """
                        INSERT INTO audit_log_event (
                          timestamp,
                          workspace_id,
                          actor,
                          method,
                          path,
                          status,
                          duration_ms,
                          client_ip,
                          request_id,
                          user_agent
                        )
                        VALUES (%(timestamp)s, %(workspace_id)s, %(actor)s, %(method)s, %(path)s,
                                %(status)s, %(duration_ms)s, %(client_ip)s, %(request_id)s, %(user_agent)s);
                        """,
                        [
                            {
                                **row,
                                "workspace_id": _storage_workspace_id(
                                    row.get("workspace_id")
                                ),
                            }
                            for row in batch
                        ],
                    )
                conn.commit()
        except Exception:
            # Best effort: audit writes must never break the request path.
            return

    def _worker_loop(self) -> None:
        while True:
            try:
                first = self._queue.get(timeout=1.0)
            except Empty:
                continue

            batch = [first]
            while len(batch) < 64:
                try:
                    batch.append(self._queue.get_nowait())
                except Empty:
                    break
            self._insert_batch(batch)

    def _cleanup_loop(self) -> None:
        while True:
            time.sleep(600)
            if not self.is_enabled():
                continue
            try:
                self.cleanup_expired_entries()
            except Exception:
                continue
