import os
import unittest
import zipfile
from io import BytesIO
from datetime import datetime, timezone
from queue import Full
from types import SimpleNamespace
from unittest.mock import patch
from services.audit_logs import (
    AuditLogConfig,
    AuditLogService,
    actor_identity,
    canonical_client_ip,
    request_id_from_headers,
)


class _Headers(dict):
    def get(self, key, default=None):
        return super().get(str(key).lower(), default)


def _build_request(
    *,
    method: str = "GET",
    path: str = "/api/workspaces/abc123/files",
    headers: dict[str, str] | None = None,
    client_host: str = "127.0.0.1",
):
    return SimpleNamespace(
        method=method,
        url=SimpleNamespace(path=path),
        headers=_Headers(
            {key.lower(): value for key, value in (headers or {}).items()}
        ),
        client=SimpleNamespace(host=client_host),
        state=SimpleNamespace(),
    )


__all__ = [
    "os",
    "unittest",
    "zipfile",
    "BytesIO",
    "datetime",
    "timezone",
    "Full",
    "SimpleNamespace",
    "patch",
    "AuditLogConfig",
    "AuditLogService",
    "actor_identity",
    "canonical_client_ip",
    "request_id_from_headers",
    "_Headers",
    "_build_request",
    "AuditLogServiceTestCase",
]


class AuditLogServiceTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._saved_env = {
            key: os.environ.get(key)
            for key in (
                "AUTH_PROXY_ENABLED",
                "AUTH_PROXY_USER_HEADER",
                "AUTH_PROXY_EMAIL_HEADER",
                "POSTGRES_HOST",
                "POSTGRES_DB",
            )
        }
        for key in (
            "AUTH_PROXY_ENABLED",
            "AUTH_PROXY_USER_HEADER",
            "AUTH_PROXY_EMAIL_HEADER",
        ):
            os.environ.pop(key, None)

    def tearDown(self) -> None:
        for key, value in self._saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
