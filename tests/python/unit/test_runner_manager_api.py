import os
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient

from manager_main import create_app


class TestRunnerManagerApi(unittest.TestCase):
    JOB_ID = "123e4567-e89b-42d3-a456-426614174000"
    RUNNER_IMAGE = "ghcr.io/example/runner@sha256:" + ("a" * 64)

    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._old_token_file = os.environ.get("MANAGER_TOKEN_FILE")
        os.environ["MANAGER_TOKEN_FILE"] = os.path.join(self._tmp.name, "token")
        with open(os.environ["MANAGER_TOKEN_FILE"], "w", encoding="utf-8") as handle:
            handle.write("secret-token")

    def tearDown(self) -> None:
        if self._old_token_file is None:
            os.environ.pop("MANAGER_TOKEN_FILE", None)
        else:
            os.environ["MANAGER_TOKEN_FILE"] = self._old_token_file

    @patch("manager_main._service")
    def test_internal_routes_reject_missing_or_bad_token(self, m_service) -> None:
        app = create_app()
        client = TestClient(app)

        payload = {
            "job_id": self.JOB_ID,
            "workspace_id": "workspace-123",
            "runner_image": self.RUNNER_IMAGE,
            "inventory_path": "inventory.yml",
            "secrets_dir": os.path.join(self._tmp.name, "secrets"),
            "role_ids": ["web-app-dashboard"],
            "network_name": f"job-{self.JOB_ID}",
            "labels": {
                "infinito.deployer.job_id": self.JOB_ID,
                "infinito.deployer.workspace_id": "workspace-123",
                "infinito.deployer.role": "job-runner",
            },
        }

        missing = client.post("/jobs", json=payload)
        wrong = client.post(
            "/jobs",
            json=payload,
            headers={"x-manager-token": "wrong"},
        )

        self.assertEqual(missing.status_code, 401)
        self.assertEqual(wrong.status_code, 401)
        m_service.assert_not_called()

    def test_internal_route_surface_matches_documented_endpoints(self) -> None:
        app = create_app()
        routes = set()
        for route in app.router.routes:
            path = getattr(route, "path", None)
            methods = getattr(route, "methods", None)
            if not path or not methods:
                continue
            for method in methods:
                routes.add((method, path))

        self.assertIn(("GET", "/health"), routes)
        self.assertIn(("POST", "/jobs"), routes)
        self.assertIn(("DELETE", "/jobs/{job_id}"), routes)
        self.assertIn(("GET", "/jobs/{job_id}"), routes)
        self.assertIn(("GET", "/jobs"), routes)
        self.assertIn(("GET", "/jobs/{job_id}/logs"), routes)

    @patch("manager_main._service")
    def test_internal_job_routes_forward_optional_workspace_scope(self, m_service) -> None:
        app = create_app()
        client = TestClient(app)
        headers = {"x-manager-token": "secret-token"}
        m_service.return_value.get.return_value = {
            "job_id": self.JOB_ID,
            "status": "running",
            "created_at": "2026-04-22T20:00:00Z",
            "started_at": None,
            "finished_at": None,
            "pid": None,
            "exit_code": None,
            "container_id": None,
            "workspace_dir": f"/state/jobs/{self.JOB_ID}",
            "log_path": f"/state/jobs/{self.JOB_ID}/job.log",
            "inventory_path": f"/state/jobs/{self.JOB_ID}/inventory.yml",
            "request_path": f"/state/jobs/{self.JOB_ID}/request.json",
        }
        m_service.return_value.cancel.return_value = True
        m_service.return_value.stream_logs.return_value = []

        get_response = client.get(
            f"/jobs/{self.JOB_ID}",
            params={"workspace_id": "workspace-123"},
            headers=headers,
        )
        delete_response = client.delete(
            f"/jobs/{self.JOB_ID}",
            params={"workspace_id": "workspace-123"},
            headers=headers,
        )
        logs_response = client.get(
            f"/jobs/{self.JOB_ID}/logs",
            params={"workspace_id": "workspace-123"},
            headers=headers,
        )

        self.assertEqual(get_response.status_code, 200)
        self.assertEqual(delete_response.status_code, 200)
        self.assertEqual(logs_response.status_code, 200)
        m_service.return_value.get.assert_called_with(
            self.JOB_ID,
            workspace_id="workspace-123",
        )
        m_service.return_value.cancel.assert_called_with(
            self.JOB_ID,
            workspace_id="workspace-123",
        )
        m_service.return_value.stream_logs.assert_called_with(
            self.JOB_ID,
            workspace_id="workspace-123",
        )
