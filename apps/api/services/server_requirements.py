from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional
from urllib.parse import quote_plus
from uuid import UUID, uuid4

from fastapi import HTTPException

try:
    import psycopg  # type: ignore[import-not-found]
except Exception:  # pragma: no cover - optional dependency for local/unit runs
    psycopg = None


def _trim(value: Optional[str]) -> str:
    return str(value or "").strip()


def _postgres_dsn_from_env() -> Optional[str]:
    for key in ("REQUIREMENTS_DATABASE_URL", "DATABASE_URL", "POSTGRES_DSN", "POSTGRES_URL"):
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


def _normalize_jsonb(value: Any) -> Dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
            return decoded if isinstance(decoded, dict) else {}
        except Exception:
            return {}
    return {}


class WorkspaceServerRequirementsService:
    def __init__(self) -> None:
        self._dsn = _postgres_dsn_from_env()
        self._schema_ready = False

    def _require_enabled(self) -> str:
        if not self._dsn:
            raise HTTPException(
                status_code=503,
                detail="requirements database is not configured (missing DATABASE_URL/POSTGRES_*)",
            )
        if psycopg is None:
            raise HTTPException(
                status_code=503,
                detail="requirements database driver not installed (missing psycopg)",
            )
        return self._dsn

    def _ensure_schema(self, conn: Any) -> None:
        if self._schema_ready:
            return
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS workspace_server (
                  id UUID PRIMARY KEY,
                  workspace_id TEXT NOT NULL,
                  alias TEXT NOT NULL,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  UNIQUE (workspace_id, alias)
                );
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS workspace_server_requirements (
                  server_id UUID PRIMARY KEY REFERENCES workspace_server(id) ON DELETE CASCADE,
                  requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_workspace_server_workspace_alias
                ON workspace_server (workspace_id, alias);
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_workspace_server_requirements_gin
                ON workspace_server_requirements USING GIN (requirements);
                """
            )
        conn.commit()
        self._schema_ready = True

    def _get_or_create_server_id(
        self, conn: Any, workspace_id: str, alias: str
    ) -> UUID:
        server_id = uuid4()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO workspace_server (id, workspace_id, alias)
                VALUES (%s, %s, %s)
                ON CONFLICT (workspace_id, alias)
                DO UPDATE SET updated_at = NOW()
                RETURNING id;
                """,
                (server_id, workspace_id, alias),
            )
            row = cur.fetchone()
        if not row or not row[0]:
            raise HTTPException(status_code=500, detail="failed to resolve server id")
        value = row[0]
        return value if isinstance(value, UUID) else UUID(str(value))

    def list_requirements(self, workspace_id: str) -> Dict[str, Dict[str, Any]]:
        dsn = self._require_enabled()
        with psycopg.connect(dsn) as conn:
            self._ensure_schema(conn)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT s.alias, r.requirements
                    FROM workspace_server s
                    LEFT JOIN workspace_server_requirements r
                      ON r.server_id = s.id
                    WHERE s.workspace_id = %s
                    ORDER BY s.alias ASC;
                    """,
                    (workspace_id,),
                )
                rows = cur.fetchall() or []
        out: Dict[str, Dict[str, Any]] = {}
        for alias, requirements in rows:
            alias_key = _trim(alias)
            if not alias_key:
                continue
            out[alias_key] = _normalize_jsonb(requirements)
        return out

    def get_requirements(self, workspace_id: str, alias: str) -> Dict[str, Any]:
        dsn = self._require_enabled()
        alias_key = _trim(alias)
        if not alias_key:
            raise HTTPException(status_code=400, detail="alias is required")
        with psycopg.connect(dsn) as conn:
            self._ensure_schema(conn)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT r.requirements
                    FROM workspace_server s
                    LEFT JOIN workspace_server_requirements r
                      ON r.server_id = s.id
                    WHERE s.workspace_id = %s AND s.alias = %s
                    LIMIT 1;
                    """,
                    (workspace_id, alias_key),
                )
                row = cur.fetchone()
        if not row:
            return {}
        return _normalize_jsonb(row[0])

    def set_requirements(
        self, workspace_id: str, alias: str, requirements: Dict[str, Any]
    ) -> Dict[str, Any]:
        dsn = self._require_enabled()
        alias_key = _trim(alias)
        if not alias_key:
            raise HTTPException(status_code=400, detail="alias is required")
        if not isinstance(requirements, dict):
            raise HTTPException(status_code=400, detail="requirements must be an object")
        with psycopg.connect(dsn) as conn:
            self._ensure_schema(conn)
            server_id = self._get_or_create_server_id(conn, workspace_id, alias_key)
            payload_json = json.dumps(requirements, separators=(",", ":"), ensure_ascii=False)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO workspace_server_requirements (server_id, requirements)
                    VALUES (%s, %s::jsonb)
                    ON CONFLICT (server_id)
                    DO UPDATE SET requirements = EXCLUDED.requirements, updated_at = NOW()
                    RETURNING requirements;
                    """,
                    (server_id, payload_json),
                )
                row = cur.fetchone()
            conn.commit()
        return _normalize_jsonb(row[0] if row else requirements)

    def rename_alias(self, workspace_id: str, from_alias: str, to_alias: str) -> bool:
        dsn = self._require_enabled()
        from_key = _trim(from_alias)
        to_key = _trim(to_alias)
        if not from_key or not to_key or from_key == to_key:
            raise HTTPException(status_code=400, detail="from_alias/to_alias required")
        with psycopg.connect(dsn) as conn:
            self._ensure_schema(conn)
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE workspace_server
                        SET alias = %s, updated_at = NOW()
                        WHERE workspace_id = %s AND alias = %s;
                        """,
                        (to_key, workspace_id, from_key),
                    )
                    updated = int(cur.rowcount or 0)
                conn.commit()
            except Exception as exc:
                detail = str(exc) or "alias rename failed"
                raise HTTPException(status_code=409, detail=detail) from exc
        return updated > 0

    def delete_alias(self, workspace_id: str, alias: str) -> bool:
        dsn = self._require_enabled()
        alias_key = _trim(alias)
        if not alias_key:
            raise HTTPException(status_code=400, detail="alias is required")
        with psycopg.connect(dsn) as conn:
            self._ensure_schema(conn)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM workspace_server
                    WHERE workspace_id = %s AND alias = %s;
                    """,
                    (workspace_id, alias_key),
                )
                deleted = int(cur.rowcount or 0)
            conn.commit()
        return deleted > 0

