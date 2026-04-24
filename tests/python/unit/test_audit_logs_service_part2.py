from ._audit_logs_service_support import *  # noqa: F403


class TestAuditLogServicePart2(AuditLogServiceTestCase):
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
