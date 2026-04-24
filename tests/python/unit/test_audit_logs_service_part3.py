from ._audit_logs_service_support import *  # noqa: F403


class TestAuditLogServicePart3(AuditLogServiceTestCase):
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
