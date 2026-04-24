from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote_plus

from fastapi import HTTPException, Request

from services.audit_logs import canonical_client_ip
from services.runner_manager_client import RunnerManagerClient

try:
    import psycopg  # type: ignore[import-not-found]
except Exception:  # pragma: no cover - optional in lightweight unit runs
    psycopg = None


def _trim(value: str | None) -> str:
    return str(value or "").strip()


def _env_int(name: str, default: int, *, minimum: int = 1) -> int:
    raw = _trim(os.getenv(name))
    try:
        value = int(raw or str(default))
    except ValueError:
        value = default
    return max(value, minimum)


def _postgres_dsn_from_env() -> str | None:
    for key in (
        "DATABASE_URL",
        "POSTGRES_DSN",
        "POSTGRES_URL",
        "AUDIT_DATABASE_URL",
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


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _window_start(now: datetime, window_seconds: int) -> datetime:
    epoch_seconds = int(now.timestamp())
    truncated = epoch_seconds - (epoch_seconds % max(window_seconds, 1))
    return datetime.fromtimestamp(truncated, tz=timezone.utc)


@dataclass(frozen=True)
class RateLimitRule:
    endpoint: str
    limit: int
    window_seconds: int


class RateLimitService:
    def __init__(self, runner_manager: RunnerManagerClient | None = None) -> None:
        self._dsn = _postgres_dsn_from_env()
        self._schema_ready = False
        self._schema_lock = threading.Lock()
        self._cleanup_started = False
        self._cleanup_lock = threading.Lock()
        self._runner_manager = runner_manager or RunnerManagerClient()
        self._start_cleanup_if_possible()

    def is_enabled(self) -> bool:
        return bool(self._dsn and psycopg is not None)

    def _require_enabled(self) -> str:
        if not self._dsn:
            raise HTTPException(
                status_code=503,
                detail="rate limit database is not configured (missing DATABASE_URL/POSTGRES_*)",
            )
        if psycopg is None:
            raise HTTPException(
                status_code=503,
                detail="rate limit database driver not installed (missing psycopg)",
            )
        return self._dsn

    def _connect(self):
        dsn = self._require_enabled()
        return psycopg.connect(dsn)  # type: ignore[union-attr]

    def deployment_hourly_rule(self) -> RateLimitRule:
        return RateLimitRule(
            endpoint="deploy_hourly",
            limit=_env_int("RATE_LIMIT_DEPLOY_PER_HOUR", 30),
            window_seconds=_env_int("RATE_LIMIT_DEPLOY_WINDOW_SECONDS", 3600),
        )

    def deployment_concurrency_limit(self) -> int:
        return _env_int("RATE_LIMIT_DEPLOY_CONCURRENT", 5)

    def test_connection_rule(self) -> RateLimitRule:
        return RateLimitRule(
            endpoint="test_conn_minute",
            limit=_env_int("RATE_LIMIT_TEST_CONN_PER_MINUTE", 10),
            window_seconds=_env_int("RATE_LIMIT_TEST_CONN_WINDOW_SECONDS", 60),
        )

    def cleanup_interval_seconds(self) -> int:
        return _env_int("RATE_LIMIT_CLEANUP_INTERVAL_SECONDS", 600)

    def cleanup_horizon_seconds(self) -> int:
        window_seconds = max(
            self.deployment_hourly_rule().window_seconds,
            self.test_connection_rule().window_seconds,
        )
        return max(window_seconds * 4, 60)

    def _start_cleanup_if_possible(self) -> None:
        if not self.is_enabled():
            return
        with self._cleanup_lock:
            if self._cleanup_started:
                return
            threading.Thread(target=self._cleanup_loop, daemon=True).start()
            self._cleanup_started = True

    def _cleanup_loop(self) -> None:
        interval = self.cleanup_interval_seconds()
        while True:
            try:
                self.cleanup_expired_entries()
            except Exception:
                pass
            time.sleep(interval)

    def _ensure_schema(self, conn: Any) -> None:
        if self._schema_ready:
            return
        with self._schema_lock:
            if self._schema_ready:
                return
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS rate_limit_events (
                      workspace_id TEXT NOT NULL,
                      client_ip TEXT NOT NULL,
                      endpoint TEXT NOT NULL,
                      window_start TIMESTAMPTZ NOT NULL,
                      count INTEGER NOT NULL DEFAULT 0,
                      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                      PRIMARY KEY (workspace_id, client_ip, endpoint, window_start)
                    );
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_rate_limit_events_endpoint_window
                    ON rate_limit_events (endpoint, window_start);
                    """
                )
            conn.commit()
            self._schema_ready = True

    def _increment_counter(
        self,
        *,
        workspace_id: str,
        client_ip: str,
        endpoint: str,
        window_start: datetime,
    ) -> int:
        with self._connect() as conn:
            self._ensure_schema(conn)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO rate_limit_events (
                      workspace_id,
                      client_ip,
                      endpoint,
                      window_start,
                      count,
                      updated_at
                    )
                    VALUES (%s, %s, %s, %s, 1, NOW())
                    ON CONFLICT (workspace_id, client_ip, endpoint, window_start)
                    DO UPDATE SET
                      count = rate_limit_events.count + 1,
                      updated_at = NOW()
                    RETURNING count;
                    """,
                    (workspace_id, client_ip, endpoint, window_start),
                )
                row = cur.fetchone()
            conn.commit()
        return int(row[0] if row else 0)

    def cleanup_expired_entries(self) -> int:
        if not self.is_enabled():
            return 0
        cutoff = _utc_now() - timedelta(seconds=self.cleanup_horizon_seconds())
        with self._connect() as conn:
            self._ensure_schema(conn)
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM rate_limit_events WHERE window_start < %s",
                    (cutoff,),
                )
                deleted = int(cur.rowcount or 0)
            conn.commit()
        return deleted

    def _require_runner_manager(self) -> None:
        if not self._runner_manager.enabled():
            raise HTTPException(
                status_code=503,
                detail="runner-manager is required for deployment concurrency checks",
            )

    def _running_job_count(self, workspace_id: str) -> int:
        self._require_runner_manager()
        return len(
            self._runner_manager.list_jobs(
                workspace_id=workspace_id,
                status="running",
            )
        )

    def _enforce_window(
        self,
        *,
        request: Request,
        workspace_id: str,
        rule: RateLimitRule,
    ) -> None:
        if not self.is_enabled():
            return
        client_ip = canonical_client_ip(request)
        count = self._increment_counter(
            workspace_id=workspace_id,
            client_ip=client_ip,
            endpoint=rule.endpoint,
            window_start=_window_start(_utc_now(), rule.window_seconds),
        )
        if count > rule.limit:
            raise HTTPException(status_code=429, detail="rate limit exceeded")

    def enforce_deployment(self, request: Request, workspace_id: str) -> None:
        if not self.is_enabled():
            return
        if self._running_job_count(workspace_id) >= self.deployment_concurrency_limit():
            raise HTTPException(status_code=429, detail="rate limit exceeded")
        self._enforce_window(
            request=request,
            workspace_id=workspace_id,
            rule=self.deployment_hourly_rule(),
        )

    def enforce_test_connection(self, request: Request, workspace_id: str) -> None:
        self._enforce_window(
            request=request,
            workspace_id=workspace_id,
            rule=self.test_connection_rule(),
        )
