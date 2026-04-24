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


class TestAuditLogService(unittest.TestCase):
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

    def test_canonical_client_ip_prefers_forwarded_header(self) -> None:
        request = _build_request(
            headers={"X-Forwarded-For": "203.0.113.7, 10.0.0.8"},
            client_host="10.0.0.5",
        )
        self.assertEqual(canonical_client_ip(request), "203.0.113.7")

    def test_canonical_client_ip_falls_back_to_unknown(self) -> None:
        request = SimpleNamespace(
            method="GET",
            url=SimpleNamespace(path="/api/workspaces/abc123/files"),
            headers=_Headers(),
            client=None,
            state=SimpleNamespace(),
        )
        self.assertEqual(canonical_client_ip(request), "unknown")

    def test_actor_identity_uses_proxy_user_when_enabled(self) -> None:
        os.environ["AUTH_PROXY_ENABLED"] = "true"
        request = _build_request(headers={"X-Auth-Request-User": "alice"})
        self.assertEqual(actor_identity(request), "alice")

    def test_request_id_uses_supported_headers(self) -> None:
        request = _build_request(headers={"X-Request-Id": "req-123"})
        self.assertEqual(request_id_from_headers(request), "req-123")

    def test_should_log_event_respects_modes_without_db(self) -> None:
        service = AuditLogService()
        self.assertTrue(
            service.should_log_event(
                workspace_id="abc123",
                method="GET",
                path="/api/workspaces/abc123/files",
                status=200,
            )
        )

    def test_build_event_uses_workspace_state_and_headers(self) -> None:
        service = AuditLogService()
        request = _build_request(
            method="POST",
            path="/api/workspaces/abc123/files/host_vars/device.yml",
            headers={
                "User-Agent": "pytest-agent",
                "X-Request-Id": "req-789",
            },
            client_host="192.0.2.44",
        )
        request.state.audit_workspace_id = "abc123"

        event = service.build_event(request=request, status=201, duration_ms=42)
        assert event is not None
        self.assertEqual(event["workspace_id"], "abc123")
        self.assertEqual(event["method"], "POST")
        self.assertEqual(
            event["path"], "/api/workspaces/abc123/files/host_vars/device.yml"
        )
        self.assertEqual(event["status"], 201)
        self.assertEqual(event["duration_ms"], 42)
        self.assertEqual(event["client_ip"], "192.0.2.44")
        self.assertEqual(event["request_id"], "req-789")
        self.assertEqual(event["user_agent"], "pytest-agent")
        self.assertEqual(event["actor"], "anonymous")

    def test_build_event_masks_free_text_fields_with_runner_secret_rules(self) -> None:
        os.environ["AUTH_PROXY_ENABLED"] = "true"
        service = AuditLogService()
        request = _build_request(
            method="POST",
            path="/api/workspaces/abc123/logs/config",
            headers={
                "User-Agent": "password=supersecret",
                "X-Request-Id": "token=tok-1234567890abcdefghijkl",
                "X-Auth-Request-User": "client_secret=topsecret",
            },
        )
        request.state.audit_workspace_id = "abc123"

        event = service.build_event(request=request, status=201, duration_ms=5)
        assert event is not None

        self.assertEqual(event["workspace_id"], "abc123")
        self.assertEqual(event["path"], "/api/workspaces/abc123/logs/config")
        self.assertEqual(event["user_agent"], "password=********")
        self.assertEqual(event["request_id"], "token=********")
        self.assertEqual(event["actor"], "client_secret=********")

    def test_should_log_event_respects_all_config_modes(self) -> None:
        service = AuditLogService()

        def allow(
            mode: str,
            *,
            method: str = "GET",
            path: str = "/api/workspaces/abc123/files",
            status: int = 200,
        ) -> bool:
            config = AuditLogConfig(workspace_id="abc123", mode=mode)
            with (
                patch.object(service, "is_enabled", return_value=True),
                patch.object(service, "get_config", return_value=config),
            ):
                return service.should_log_event(
                    workspace_id="abc123",
                    method=method,
                    path=path,
                    status=status,
                )

        self.assertTrue(allow("all"))
        self.assertTrue(allow("writes-only", method="POST"))
        self.assertFalse(allow("writes-only", method="GET"))
        self.assertTrue(allow("auth-only", path="/api/auth/session"))
        self.assertFalse(allow("auth-only", path="/api/workspaces/abc123/files"))
        self.assertTrue(allow("deployment-only", path="/api/deployments"))
        self.assertFalse(allow("deployment-only", path="/api/workspaces/abc123/files"))
        self.assertTrue(allow("errors-only", status=500))
        self.assertFalse(allow("errors-only", status=200))

    def test_should_log_event_can_exclude_health_endpoints(self) -> None:
        service = AuditLogService()
        config = AuditLogConfig(
            workspace_id="abc123",
            mode="all",
            exclude_health_endpoints=True,
        )
        with (
            patch.object(service, "is_enabled", return_value=True),
            patch.object(service, "get_config", return_value=config),
        ):
            self.assertFalse(
                service.should_log_event(
                    workspace_id="abc123",
                    method="GET",
                    path="/health",
                    status=200,
                )
            )
            self.assertFalse(
                service.should_log_event(
                    workspace_id="abc123",
                    method="GET",
                    path="/api/health",
                    status=200,
                )
            )
            self.assertTrue(
                service.should_log_event(
                    workspace_id="abc123",
                    method="GET",
                    path="/api/workspaces/abc123/files",
                    status=200,
                )
            )

    def test_build_filter_clause_includes_all_supported_filters(self) -> None:
        service = AuditLogService()
        from_ts = datetime(2026, 4, 21, 10, 0, tzinfo=timezone.utc)
        to_ts = datetime(2026, 4, 21, 11, 0, tzinfo=timezone.utc)

        where_sql, params = service._build_filter_clause(
            workspace_id="abc123",
            from_ts=from_ts,
            to_ts=to_ts,
            user="alice",
            ip="203.0.113.7",
            q="deploy",
            status=500,
            method="post",
        )

        self.assertIn("workspace_id = %s", where_sql)
        self.assertIn("timestamp >= %s", where_sql)
        self.assertIn("timestamp <= %s", where_sql)
        self.assertIn("actor = %s", where_sql)
        self.assertIn("client_ip = %s", where_sql)
        self.assertIn("status = %s", where_sql)
        self.assertIn("method = %s", where_sql)
        self.assertIn("path ILIKE %s", where_sql)
        self.assertIn("COALESCE(user_agent, '') ILIKE %s", where_sql)
        self.assertEqual(
            params,
            [
                "abc123",
                from_ts,
                to_ts,
                "alice",
                "203.0.113.7",
                500,
                "POST",
                "%deploy%",
                "%deploy%",
                "%deploy%",
                "%deploy%",
            ],
        )

    def test_encode_helpers_emit_utf8_payloads(self) -> None:
        service = AuditLogService()
        rows = [
            {
                "id": 7,
                "timestamp": datetime(2026, 4, 21, 10, 15, tzinfo=timezone.utc),
                "workspace_id": "abc123",
                "user": "alice",
                "method": "POST",
                "path": "/api/workspaces/abc123/files",
                "status": 201,
                "duration_ms": 42,
                "ip": "203.0.113.7",
                "request_id": "req-7",
                "user_agent": "pytest/ä",
            }
        ]

        jsonl = service._encode_jsonl(rows).decode("utf-8")
        csv_text = service._encode_csv(rows).decode("utf-8")

        self.assertIn('"workspace_id": "abc123"', jsonl)
        self.assertIn('"user_agent": "pytest/ä"', jsonl)
        self.assertIn('"timestamp": "2026-04-21T10:15:00Z"', jsonl)
        self.assertTrue(jsonl.endswith("\n"))
        self.assertIn(
            "workspace_id,user,method,path,status,duration_ms,ip,request_id,user_agent",
            csv_text,
        )
        self.assertIn("2026-04-21T10:15:00Z", csv_text)
        self.assertIn(
            "abc123,alice,POST,/api/workspaces/abc123/files,201,42,203.0.113.7,req-7,pytest/ä",
            csv_text,
        )

    def test_export_entries_can_zip_single_data_file(self) -> None:
        service = AuditLogService()
        rows = [
            {
                "id": 7,
                "timestamp": datetime(2026, 4, 21, 10, 15, tzinfo=timezone.utc),
                "workspace_id": "abc123",
                "user": "alice",
                "method": "POST",
                "path": "/api/workspaces/abc123/files",
                "status": 201,
                "duration_ms": 42,
                "ip": "203.0.113.7",
                "request_id": "req-7",
                "user_agent": "pytest-agent",
            }
        ]
        with patch.object(service, "_fetch_entries_for_export", return_value=rows):
            result = service.export_entries(
                "abc123",
                fmt="jsonl",
                zipped=True,
                from_ts=None,
                to_ts=None,
                user=None,
                ip=None,
                q=None,
                status=None,
                method=None,
            )

        self.assertEqual(result["filename"], "audit-log-abc123.zip")
        self.assertEqual(result["media_type"], "application/zip")
        with zipfile.ZipFile(BytesIO(result["body"])) as archive:
            self.assertEqual(archive.namelist(), ["audit-log-abc123.jsonl"])
            self.assertIn(
                '"workspace_id": "abc123"',
                archive.read("audit-log-abc123.jsonl").decode("utf-8"),
            )

    def test_cleanup_expired_entries_returns_deleted_rows(self) -> None:
        service = AuditLogService()

        class _FakeCursor:
            rowcount = 4

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def execute(self, _sql, _params):
                return None

        class _FakeConn:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def cursor(self):
                return _FakeCursor()

            def commit(self):
                return None

        with patch.object(service, "_connect", return_value=_FakeConn()):
            deleted = service.cleanup_expired_entries()

        self.assertEqual(deleted, 4)

    def test_row_to_entry_hides_internal_global_workspace_storage_id(self) -> None:
        service = AuditLogService()
        row = (
            12,
            datetime(2026, 4, 21, 10, 15, tzinfo=timezone.utc),
            "__global__",
            "anonymous",
            "GET",
            "/api/health",
            200,
            7,
            "127.0.0.1",
            None,
            None,
        )

        entry = service._row_to_entry(row)

        self.assertIsNone(entry["workspace_id"])

    def test_insert_batch_persists_global_workspace_id_for_non_workspace_events(
        self,
    ) -> None:
        service = AuditLogService()
        captured: list[dict[str, object]] = []

        class _FakeCursor:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def executemany(self, _sql, rows):
                captured.extend(list(rows))

        class _FakeConn:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def cursor(self):
                return _FakeCursor()

            def commit(self):
                return None

        with patch.object(service, "_connect", return_value=_FakeConn()):
            service._insert_batch(
                [
                    {
                        "timestamp": datetime(2026, 4, 21, 10, 15, tzinfo=timezone.utc),
                        "workspace_id": None,
                        "actor": "anonymous",
                        "method": "GET",
                        "path": "/health",
                        "status": 200,
                        "duration_ms": 7,
                        "client_ip": "127.0.0.1",
                        "request_id": None,
                        "user_agent": None,
                    }
                ]
            )

        self.assertEqual(captured[0]["workspace_id"], "__global__")

    def test_enqueue_event_falls_back_to_background_insert_when_queue_is_full(
        self,
    ) -> None:
        service = AuditLogService()

        class _AlwaysFullQueue:
            def put_nowait(self, _event):
                raise Full

        started: list[tuple[object, tuple[object, ...], bool | None] | str] = []

        class _FakeThread:
            def __init__(self, target=None, args=(), daemon=None):
                started.append((target, args, daemon))
                self._target = target
                self._args = args

            def start(self):
                started.append("started")

        service._queue = _AlwaysFullQueue()  # type: ignore[assignment]
        with (
            patch.object(service, "is_enabled", return_value=True),
            patch.object(service, "_start_threads_if_possible", return_value=None),
            patch("services.audit_logs.threading.Thread", _FakeThread),
        ):
            service.enqueue_event({"path": "/api/test"})

        self.assertEqual(started[0][0], service._insert_batch)
        self.assertEqual(started[0][1], ([{"path": "/api/test"}],))
        self.assertEqual(started[1], "started")

    def test_stream_export_entries_runs_export_in_background_thread(self) -> None:
        service = AuditLogService()
        started = {"count": 0}

        class _ImmediateThread:
            def __init__(self, target=None, args=(), daemon=None):
                self._target = target
                self._args = args

            def start(self):
                started["count"] += 1
                if self._target is not None:
                    self._target(*self._args)

        with (
            patch.object(
                service,
                "export_entries",
                return_value={
                    "body": b'{"timestamp":"2026-04-21T10:15:00Z"}\n',
                    "filename": "audit-log-abc123.jsonl",
                    "media_type": "application/x-ndjson",
                },
            ),
            patch("services.audit_logs.threading.Thread", _ImmediateThread),
        ):
            result = service.stream_export_entries(
                "abc123",
                fmt="jsonl",
                zipped=False,
                from_ts=None,
                to_ts=None,
                user=None,
                ip=None,
                q=None,
                status=None,
                method=None,
            )
            body = b"".join(result["body"])

        self.assertEqual(started["count"], 1)
        self.assertEqual(result["filename"], "audit-log-abc123.jsonl")
        self.assertEqual(result["media_type"], "application/x-ndjson")
        self.assertEqual(body, b'{"timestamp":"2026-04-21T10:15:00Z"}\n')

    def test_row_to_entry_normalizes_timestamp_to_z_suffix(self) -> None:
        service = AuditLogService()
        row = (
            11,
            datetime(2026, 4, 21, 10, 15, tzinfo=timezone.utc),
            "abc123",
            "alice",
            "post",
            "/api/workspaces/abc123/files",
            201,
            42,
            "203.0.113.7",
            "req-11",
            "pytest-agent",
        )

        entry = service._row_to_entry(row)

        self.assertEqual(entry["timestamp"], "2026-04-21T10:15:00Z")
        self.assertEqual(entry["method"], "POST")

    def test_list_entries_filters_return_expected_subset(self) -> None:
        service = AuditLogService()
        rows = [
            (
                3,
                datetime(2026, 4, 21, 10, 20, tzinfo=timezone.utc),
                "abc123",
                "alice",
                "POST",
                "/api/deployments",
                500,
                120,
                "203.0.113.7",
                "req-3",
                "agent deploy",
            ),
            (
                2,
                datetime(2026, 4, 21, 10, 10, tzinfo=timezone.utc),
                "abc123",
                "bob",
                "GET",
                "/api/workspaces/abc123/logs/config",
                200,
                12,
                "198.51.100.8",
                "req-2",
                "agent browse",
            ),
            (
                1,
                datetime(2026, 4, 21, 9, 55, tzinfo=timezone.utc),
                "other",
                "alice",
                "POST",
                "/api/deployments",
                500,
                90,
                "203.0.113.7",
                "req-1",
                "agent deploy",
            ),
        ]

        class _FakeCursor:
            def __init__(self, dataset):
                self._dataset = list(dataset)
                self._result = []

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def execute(self, sql, params):
                filtered = list(self._dataset)
                args = list(params)
                index = 0
                workspace_id = args[index]
                index += 1

                filtered = [row for row in filtered if row[2] == workspace_id]

                if "timestamp >= %s" in sql:
                    from_ts = args[index]
                    index += 1
                    filtered = [row for row in filtered if row[1] >= from_ts]
                if "timestamp <= %s" in sql:
                    to_ts = args[index]
                    index += 1
                    filtered = [row for row in filtered if row[1] <= to_ts]
                if "actor = %s" in sql:
                    actor = args[index]
                    index += 1
                    filtered = [row for row in filtered if row[3] == actor]
                if "client_ip = %s" in sql:
                    client_ip = args[index]
                    index += 1
                    filtered = [row for row in filtered if row[8] == client_ip]
                if "status = %s" in sql:
                    status = args[index]
                    index += 1
                    filtered = [row for row in filtered if row[6] == status]
                if "method = %s" in sql:
                    method = args[index]
                    index += 1
                    filtered = [row for row in filtered if row[4] == method]
                if "path ILIKE %s" in sql:
                    query = str(args[index]).strip("%").lower()
                    index += 4

                    def _matches_query(row):
                        haystack = " ".join(
                            [
                                str(row[5]),
                                str(row[3]),
                                str(row[10] or ""),
                                str(row[9] or ""),
                            ]
                        ).lower()
                        return query in haystack

                    filtered = [row for row in filtered if _matches_query(row)]

                filtered.sort(key=lambda row: (row[1], row[0]), reverse=True)

                if "COUNT(*)" in sql:
                    self._result = [(len(filtered),)]
                    return

                limit = int(args[-2])
                offset = int(args[-1])
                self._result = filtered[offset : offset + limit]

            def fetchone(self):
                return self._result[0] if self._result else None

            def fetchall(self):
                return list(self._result)

        class _FakeConn:
            def __init__(self, dataset):
                self._dataset = dataset

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def cursor(self):
                return _FakeCursor(self._dataset)

        with patch.object(service, "_connect", return_value=_FakeConn(rows)):
            result = service.list_entries(
                "abc123",
                page=1,
                page_size=50,
                from_ts=datetime(2026, 4, 21, 10, 0, tzinfo=timezone.utc),
                to_ts=datetime(2026, 4, 21, 11, 0, tzinfo=timezone.utc),
                user="alice",
                ip="203.0.113.7",
                q="deploy",
                status=500,
                method="post",
            )

        self.assertEqual(result["total"], 1)
        self.assertEqual(len(result["entries"]), 1)
        self.assertEqual(result["entries"][0]["id"], 3)
        self.assertEqual(result["entries"][0]["user"], "alice")
        self.assertEqual(result["entries"][0]["status"], 500)
        self.assertEqual(result["entries"][0]["method"], "POST")
