from __future__ import annotations

import importlib
import os
import unittest
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient


class _FakeRateLimits:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self._error: HTTPException | None = None

    def fail_with(self, status_code: int) -> None:
        self._error = HTTPException(
            status_code=status_code, detail="rate limit exceeded"
        )

    def enforce_deployment(self, _request, workspace_id: str) -> None:
        self.calls.append(("deploy", workspace_id))
        if self._error is not None:
            raise self._error

    def enforce_test_connection(self, _request, workspace_id: str) -> None:
        self.calls.append(("test-connection", workspace_id))
        if self._error is not None:
            raise self._error


class TestRateLimitsApi(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._saved_env = {
            key: os.environ.get(key)
            for key in (
                "ALLOWED_ORIGINS",
                "AUTH_PROXY_ENABLED",
                "CORS_ALLOW_ORIGINS",
                "STATE_DIR",
            )
        }
        os.environ["STATE_DIR"] = self._tmp.name
        os.environ["ALLOWED_ORIGINS"] = "http://127.0.0.1:3000"
        os.environ["CORS_ALLOW_ORIGINS"] = ""
        os.environ["AUTH_PROXY_ENABLED"] = "false"

    def tearDown(self) -> None:
        for key, value in self._saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def _client(self) -> tuple[TestClient, _FakeRateLimits]:
        main_module = importlib.import_module("main")
        app = main_module.create_app()
        rate_limits = _FakeRateLimits()
        app.state.rate_limits = rate_limits
        return TestClient(app), rate_limits

    def _csrf_headers(self, client: TestClient) -> dict[str, str]:
        client.get("/health")
        csrf_cookie = client.cookies.get("csrf") or ""
        return {
            "Cookie": f"csrf={csrf_cookie}",
            "X-CSRF": csrf_cookie,
        }

    def test_deployments_route_checks_rate_limits_before_starting_job(self) -> None:
        client, rate_limits = self._client()

        with (
            patch("api.routes.deployments.ensure_workspace_access") as m_access,
            patch("api.routes.deployments._roles") as m_roles,
            patch("api.routes.deployments._jobs") as m_jobs,
            patch("api.routes.deployments._workspaces") as m_workspaces,
        ):
            m_access.return_value = None
            m_roles.return_value.get.return_value = SimpleNamespace(
                id="web-app-dashboard"
            )
            m_jobs.return_value.create.return_value = SimpleNamespace(job_id="job-1")

            response = client.post(
                "/api/deployments",
                json={
                    "workspace_id": "workspace-123",
                    "host": "ssh-password",
                    "port": 22,
                    "user": "deploy",
                    "auth": {"method": "password", "password": "deploy"},
                    "selected_roles": ["web-app-dashboard"],
                },
                headers=self._csrf_headers(client),
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(rate_limits.calls, [("deploy", "workspace-123")])
        m_jobs.return_value.create.assert_called_once()
        m_workspaces.return_value.set_workspace_state.assert_called_once_with(
            "workspace-123",
            "deployed",
        )

    def test_deployments_route_returns_429_when_rate_limit_rejects(self) -> None:
        client, rate_limits = self._client()
        rate_limits.fail_with(429)

        with (
            patch("api.routes.deployments.ensure_workspace_access") as m_access,
            patch("api.routes.deployments._roles") as m_roles,
            patch("api.routes.deployments._jobs") as m_jobs,
        ):
            m_access.return_value = None

            response = client.post(
                "/api/deployments",
                json={
                    "workspace_id": "workspace-123",
                    "host": "ssh-password",
                    "port": 22,
                    "user": "deploy",
                    "auth": {"method": "password", "password": "deploy"},
                    "selected_roles": [],
                    "playbook_path": "playbooks/site.yml",
                },
                headers=self._csrf_headers(client),
            )

        self.assertEqual(response.status_code, 429)
        self.assertEqual(rate_limits.calls, [("deploy", "workspace-123")])
        m_roles.assert_not_called()
        m_jobs.assert_not_called()

    def test_test_connection_route_checks_rate_limits_before_running_probe(
        self,
    ) -> None:
        client, rate_limits = self._client()

        with (
            patch("api.routes.workspaces.ensure_workspace_access") as m_access,
            patch("api.routes.workspaces._svc") as m_workspaces,
        ):
            m_access.return_value = None
            m_workspaces.return_value.test_connection.return_value = {
                "ping_ok": True,
                "ping_error": None,
                "ssh_ok": True,
                "ssh_error": None,
            }

            response = client.post(
                "/api/workspaces/workspace-456/test-connection",
                json={
                    "host": "ssh-password",
                    "port": 22,
                    "user": "deploy",
                    "auth_method": "password",
                    "password": "deploy",
                },
                headers=self._csrf_headers(client),
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(rate_limits.calls, [("test-connection", "workspace-456")])
        m_workspaces.return_value.test_connection.assert_called_once()

    def test_test_connection_route_returns_429_when_rate_limit_rejects(self) -> None:
        client, rate_limits = self._client()
        rate_limits.fail_with(429)

        with (
            patch("api.routes.workspaces.ensure_workspace_access") as m_access,
            patch("api.routes.workspaces._svc") as m_workspaces,
        ):
            m_access.return_value = None

            response = client.post(
                "/api/workspaces/workspace-456/test-connection",
                json={
                    "host": "ssh-password",
                    "port": 22,
                    "user": "deploy",
                    "auth_method": "password",
                    "password": "deploy",
                },
                headers=self._csrf_headers(client),
            )

        self.assertEqual(response.status_code, 429)
        self.assertEqual(rate_limits.calls, [("test-connection", "workspace-456")])
        m_workspaces.return_value.test_connection.assert_not_called()


if __name__ == "__main__":
    unittest.main()
