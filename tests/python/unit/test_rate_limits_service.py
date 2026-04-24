from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException

from services.rate_limits import RateLimitService


class _Headers(dict):
    def get(self, key, default=None):
        return super().get(str(key).lower(), default)


def _build_request(
    *,
    headers: dict[str, str] | None = None,
    client_host: str = "127.0.0.1",
):
    return SimpleNamespace(
        headers=_Headers({key.lower(): value for key, value in (headers or {}).items()}),
        client=SimpleNamespace(host=client_host),
    )


class TestRateLimitService(unittest.TestCase):
    def test_deployment_enforcement_uses_runner_manager_running_jobs_as_source(
        self,
    ) -> None:
        runner_manager = Mock()
        runner_manager.enabled.return_value = True
        runner_manager.list_jobs.return_value = [object(), object()]
        service = RateLimitService(runner_manager=runner_manager)
        request = _build_request(headers={"X-Forwarded-For": "203.0.113.7"})

        with (
            patch.object(service, "is_enabled", return_value=True),
            patch.object(service, "_increment_counter", return_value=1) as m_increment,
        ):
            service.enforce_deployment(request, "workspace-123")

        runner_manager.list_jobs.assert_called_once_with(
            workspace_id="workspace-123",
            status="running",
        )
        kwargs = m_increment.call_args.kwargs
        self.assertEqual(kwargs["workspace_id"], "workspace-123")
        self.assertEqual(kwargs["client_ip"], "203.0.113.7")
        self.assertEqual(kwargs["endpoint"], "deploy_hourly")
        self.assertIsInstance(kwargs["window_start"], datetime)

    def test_deployment_enforcement_rejects_when_concurrent_limit_is_hit(self) -> None:
        runner_manager = Mock()
        runner_manager.enabled.return_value = True
        runner_manager.list_jobs.return_value = [object()] * 5
        service = RateLimitService(runner_manager=runner_manager)

        with (
            patch.object(service, "is_enabled", return_value=True),
            patch.object(service, "_increment_counter") as m_increment,
        ):
            with self.assertRaises(HTTPException) as ctx:
                service.enforce_deployment(_build_request(), "workspace-123")

        self.assertEqual(ctx.exception.status_code, 429)
        m_increment.assert_not_called()

    def test_deployment_enforcement_rejects_when_hourly_limit_is_hit(self) -> None:
        runner_manager = Mock()
        runner_manager.enabled.return_value = True
        runner_manager.list_jobs.return_value = []
        service = RateLimitService(runner_manager=runner_manager)

        with (
            patch.object(service, "is_enabled", return_value=True),
            patch.object(service, "_increment_counter", return_value=31),
        ):
            with self.assertRaises(HTTPException) as ctx:
                service.enforce_deployment(_build_request(), "workspace-123")

        self.assertEqual(ctx.exception.status_code, 429)

    def test_test_connection_enforcement_uses_workspace_and_ip_key(self) -> None:
        runner_manager = Mock()
        service = RateLimitService(runner_manager=runner_manager)
        request = _build_request(headers={"X-Forwarded-For": "198.51.100.9"})

        with (
            patch.object(service, "is_enabled", return_value=True),
            patch.object(service, "_increment_counter", return_value=1) as m_increment,
        ):
            service.enforce_test_connection(request, "workspace-456")

        runner_manager.list_jobs.assert_not_called()
        kwargs = m_increment.call_args.kwargs
        self.assertEqual(kwargs["workspace_id"], "workspace-456")
        self.assertEqual(kwargs["client_ip"], "198.51.100.9")
        self.assertEqual(kwargs["endpoint"], "test_conn_minute")
        self.assertIsInstance(kwargs["window_start"], datetime)

    def test_increment_counter_uses_atomic_upsert(self) -> None:
        service = RateLimitService()
        service._schema_ready = True
        recorded: list[tuple[str, tuple[object, ...]]] = []

        class _FakeCursor:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def execute(self, sql, params):
                recorded.append((sql, tuple(params)))

            def fetchone(self):
                return (3,)

        class _FakeConn:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def cursor(self):
                return _FakeCursor()

            def commit(self):
                return None

        window_start = datetime(2026, 4, 23, 20, 0, tzinfo=timezone.utc)
        with patch.object(service, "_connect", return_value=_FakeConn()):
            count = service._increment_counter(
                workspace_id="workspace-123",
                client_ip="203.0.113.7",
                endpoint="deploy_hourly",
                window_start=window_start,
            )

        self.assertEqual(count, 3)
        sql, params = recorded[0]
        self.assertIn("ON CONFLICT", sql)
        self.assertIn("count = rate_limit_events.count + 1", sql)
        self.assertEqual(
            params,
            ("workspace-123", "203.0.113.7", "deploy_hourly", window_start),
        )

    def test_cleanup_expired_entries_uses_max_window_times_four(self) -> None:
        service = RateLimitService()
        service._schema_ready = True
        recorded_params: list[tuple[object, ...]] = []

        class _FakeCursor:
            rowcount = 4

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def execute(self, _sql, params):
                recorded_params.append(tuple(params))

        class _FakeConn:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def cursor(self):
                return _FakeCursor()

            def commit(self):
                return None

        now = datetime(2026, 4, 23, 20, 0, tzinfo=timezone.utc)
        with (
            patch.object(service, "is_enabled", return_value=True),
            patch.object(service, "_connect", return_value=_FakeConn()),
            patch("services.rate_limits._utc_now", return_value=now),
        ):
            deleted = service.cleanup_expired_entries()

        self.assertEqual(deleted, 4)
        self.assertEqual(recorded_params[0][0], now - timedelta(hours=4))


if __name__ == "__main__":
    unittest.main()
