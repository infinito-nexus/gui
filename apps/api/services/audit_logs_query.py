from __future__ import annotations

import importlib
import io
from datetime import datetime
from queue import Queue
from typing import Any, Iterable

from fastapi import HTTPException, Request

from .audit_logs_support import (
    AUTH_PATH_TOKENS,
    DEFAULT_LOG_MODE,
    DEFAULT_RETENTION_DAYS,
    HEALTH_PATHS,
    AuditLogConfig,
    actor_identity,
    canonical_client_ip,
    encode_csv,
    encode_jsonl,
    mask_audit_text,
    request_id_from_headers,
    row_to_entry,
    trim,
    utc_now,
)


def _root():
    return importlib.import_module("services.audit_logs")


class AuditLogServiceQueryMixin:
    def get_config(self, workspace_id: str) -> AuditLogConfig:
        workspace_key = trim(workspace_id)
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
                mode=trim(row[1]) or DEFAULT_LOG_MODE,
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
        workspace_key = trim(workspace_id)
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
            mode=trim(row[1]) or mode,
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
        workspace_key = trim(workspace_id) or None
        config = (
            self.get_config(workspace_key)
            if workspace_key and self.is_enabled()
            else AuditLogConfig(workspace_id=workspace_key or "")
        )

        normalized_path = trim(path) or "/"
        normalized_method = (trim(method) or "GET").upper()

        if config.exclude_health_endpoints and normalized_path in HEALTH_PATHS:
            return False

        mode = config.mode or DEFAULT_LOG_MODE
        if mode == "all":
            return True
        if mode == "writes-only":
            return normalized_method in {"POST", "PUT", "PATCH", "DELETE"}
        if mode == "auth-only":
            return any(token in normalized_path for token in AUTH_PATH_TOKENS)
        if mode == "deployment-only":
            return normalized_path.startswith("/api/deployments")
        if mode == "errors-only":
            return int(status) >= 400
        return True

    def build_event(
        self,
        *,
        request: Request,
        status: int,
        duration_ms: int,
    ) -> dict[str, Any] | None:
        workspace_id = trim(getattr(request.state, "audit_workspace_id", None)) or None
        path = trim(request.url.path) or "/"
        method = (trim(request.method) or "GET").upper()
        if not self.should_log_event(
            workspace_id=workspace_id,
            method=method,
            path=path,
            status=status,
        ):
            return None

        user_agent = trim(request.headers.get("user-agent")) or None
        return {
            "timestamp": utc_now(),
            "workspace_id": workspace_id,
            "actor": mask_audit_text(actor_identity(request)) or "anonymous",
            "method": method,
            "path": path,
            "status": int(status),
            "duration_ms": max(int(duration_ms), 0),
            "client_ip": canonical_client_ip(request),
            "request_id": mask_audit_text(request_id_from_headers(request)),
            "user_agent": mask_audit_text(user_agent),
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
        workspace_key = trim(workspace_id)
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
                    [*params, page_size, (page - 1) * page_size],
                )
                rows = cur.fetchall() or []

        return {
            "entries": [row_to_entry(row) for row in rows],
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
        workspace_key = trim(workspace_id)
        if not workspace_key:
            raise HTTPException(status_code=400, detail="workspace_id is required")
        normalized_format = trim(fmt).lower() or "jsonl"
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
            encode_jsonl(rows) if normalized_format == "jsonl" else encode_csv(rows)
        )
        file_name = f"audit-log-{workspace_key}.{normalized_format}"
        media_type = (
            "application/x-ndjson"
            if normalized_format == "jsonl"
            else "text/csv; charset=utf-8"
        )

        if zipped:
            import zipfile

            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(
                zip_buffer,
                mode="w",
                compression=zipfile.ZIP_DEFLATED,
            ) as zf:
                zf.writestr(file_name, payload)
            return {
                "body": zip_buffer.getvalue(),
                "filename": f"audit-log-{workspace_key}.zip",
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
        workspace_key = trim(workspace_id)
        if not workspace_key:
            raise HTTPException(status_code=400, detail="workspace_id is required")
        normalized_format = trim(fmt).lower() or "jsonl"
        if normalized_format not in {"jsonl", "csv"}:
            raise HTTPException(status_code=400, detail="unsupported export format")

        filename = f"audit-log-{workspace_key}.{normalized_format}"
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
            except Exception as exc:
                chunk_queue.put(exc)
            finally:
                chunk_queue.put(None)

        _root().threading.Thread(target=worker, daemon=True).start()

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
        return [row_to_entry(row) for row in rows]

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
        if trim(user):
            clauses.append("actor = %s")
            params.append(trim(user))
        if trim(ip):
            clauses.append("client_ip = %s")
            params.append(trim(ip))
        if status is not None:
            clauses.append("status = %s")
            params.append(int(status))
        if trim(method):
            clauses.append("method = %s")
            params.append(trim(method).upper())
        if trim(q):
            params.append(f"%{trim(q)}%")
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
