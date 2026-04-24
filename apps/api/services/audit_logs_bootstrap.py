from __future__ import annotations

import importlib
import time
from queue import Empty, Full, Queue
from typing import Any, Sequence

from fastapi import HTTPException

from .audit_logs_support import (
    DEFAULT_RETENTION_DAYS,
    AuditLogConfig,
    isoformat_z,
    mask_audit_text,
    postgres_dsn_from_env,
    psycopg,
    storage_workspace_id,
    trim,
    utc_now,
)


def _root():
    return importlib.import_module("services.audit_logs")


class AuditLogServiceBootstrapMixin:
    def __init__(self) -> None:
        root = _root()
        self._dsn = postgres_dsn_from_env()
        self._schema_ready = False
        self._schema_lock = root.threading.Lock()
        self._config_cache: dict[str, AuditLogConfig] = {}
        self._config_lock = root.threading.Lock()
        self._queue: Queue[dict[str, Any]] = Queue(maxsize=4096)
        self._worker_started = False
        self._cleanup_started = False
        self._threads_lock = root.threading.Lock()
        self._start_threads_if_possible()

    def _start_threads_if_possible(self) -> None:
        root = _root()
        if not self.is_enabled():
            return
        with self._threads_lock:
            if not self._worker_started:
                root.threading.Thread(target=self._worker_loop, daemon=True).start()
                self._worker_started = True
            if not self._cleanup_started:
                root.threading.Thread(target=self._cleanup_loop, daemon=True).start()
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
                    ("__global__",),
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

    def enqueue_event(self, event: dict[str, Any]) -> None:
        root = _root()
        if not self.is_enabled():
            return
        self._start_threads_if_possible()
        try:
            self._queue.put_nowait(event)
        except Full:
            root.threading.Thread(
                target=self._insert_batch,
                args=([event],),
                daemon=True,
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
            "timestamp": isoformat_z(utc_now()),
            "workspace_id": storage_workspace_id(workspace_id),
            "actor": trim(actor) or "runner-manager",
            "method": "SYSTEM",
            "path": trim(path) or "/internal/system",
            "status": int(status),
            "duration_ms": max(int(duration_ms), 0),
            "client_ip": trim(client_ip) or "runner-manager",
            "request_id": mask_audit_text(request_id),
            "user_agent": mask_audit_text(user_agent),
        }
        self.enqueue_event(event)

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
                                "workspace_id": storage_workspace_id(
                                    row.get("workspace_id")
                                ),
                            }
                            for row in batch
                        ],
                    )
                conn.commit()
        except Exception:
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
