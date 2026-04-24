from __future__ import annotations

import importlib
import os
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient


class TestRoleInputValidation(unittest.TestCase):
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

    def _client(self) -> TestClient:
        main_module = importlib.import_module("main")
        return TestClient(main_module.create_app())

    def _csrf_headers(self, client: TestClient) -> dict[str, str]:
        client.get("/health")
        csrf_cookie = client.cookies.get("csrf") or ""
        return {
            "Cookie": f"csrf={csrf_cookie}",
            "X-CSRF": csrf_cookie,
        }

    def _create_workspace(self, client: TestClient) -> str:
        response = client.post("/api/workspaces", headers=self._csrf_headers(client))
        self.assertEqual(response.status_code, 200)
        return str(response.json()["workspace_id"])

    @patch("api.routes.deployments._roles")
    @patch("api.routes.deployments._jobs")
    def test_create_deployment_rejects_unknown_role_id_before_runner_start(
        self,
        m_jobs,
        m_roles,
    ) -> None:
        client = self._client()
        workspace_id = self._create_workspace(client)
        m_roles.return_value.get.side_effect = HTTPException(
            status_code=404,
            detail="role not found",
        )

        response = client.post(
            "/api/deployments",
            json={
                "workspace_id": workspace_id,
                "host": "ssh-password",
                "port": 22,
                "user": "deploy",
                "auth": {"method": "password", "password": "deploy"},
                "selected_roles": ["web-app-does-not-exist"],
            },
            headers=self._csrf_headers(client),
        )

        self.assertEqual(response.status_code, 404)
        self.assertIn("role not found", response.text)
        m_jobs.assert_not_called()

    @patch("api.routes.inventories._roles")
    @patch("api.routes.inventories.build_inventory_preview")
    def test_inventory_preview_rejects_unknown_role_id_before_preview_build(
        self,
        m_build_preview,
        m_roles,
    ) -> None:
        client = self._client()
        workspace_id = self._create_workspace(client)
        m_roles.return_value.get.side_effect = HTTPException(
            status_code=404,
            detail="role not found",
        )

        response = client.post(
            "/api/inventories/preview",
            json={
                "workspace_id": workspace_id,
                "host": "ssh-password",
                "port": 22,
                "user": "deploy",
                "auth": {"method": "password", "password": "deploy"},
                "selected_roles": ["web-app-does-not-exist"],
            },
            headers=self._csrf_headers(client),
        )

        self.assertEqual(response.status_code, 404)
        self.assertIn("role not found", response.text)
        m_build_preview.assert_not_called()

    def test_generate_inventory_rejects_unknown_role_id_before_workspace_write(
        self,
    ) -> None:
        client = self._client()
        workspace_id = self._create_workspace(client)

        with (
            patch("api.routes.workspaces_management_routes._roles") as m_roles,
            patch("api.routes.workspaces_management_routes._svc") as m_workspaces,
        ):
            m_roles.return_value.get.side_effect = HTTPException(
                status_code=404,
                detail="role not found",
            )
            m_workspaces.return_value.list_files.return_value = []

            response = client.post(
                f"/api/workspaces/{workspace_id}/generate-inventory",
                json={
                    "alias": "device",
                    "host": "ssh-password",
                    "port": 22,
                    "user": "deploy",
                    "selected_roles": ["web-app-does-not-exist"],
                },
                headers=self._csrf_headers(client),
            )

        self.assertEqual(response.status_code, 404)
        self.assertIn("role not found", response.text)
        m_workspaces.return_value.generate_inventory.assert_not_called()

    def test_generate_credentials_rejects_unknown_role_id_before_service_write(
        self,
    ) -> None:
        client = self._client()
        workspace_id = self._create_workspace(client)

        with (
            patch("api.routes.workspaces.ensure_workspace_access") as m_access,
            patch("api.routes.workspaces._roles") as m_roles,
            patch("api.routes.workspaces._svc") as m_workspaces,
        ):
            m_access.return_value = None
            m_roles.return_value.get.side_effect = HTTPException(
                status_code=404,
                detail="role not found",
            )

            response = client.post(
                f"/api/workspaces/{workspace_id}/credentials",
                json={
                    "master_password": "secret",
                    "selected_roles": ["web-app-does-not-exist"],
                },
                headers=self._csrf_headers(client),
            )

        self.assertEqual(response.status_code, 404)
        self.assertIn("role not found", response.text)
        m_workspaces.return_value.generate_credentials.assert_not_called()

    def test_role_app_config_rejects_unknown_role_id_before_service_read(self) -> None:
        client = self._client()
        workspace_id = self._create_workspace(client)

        with (
            patch("api.routes.workspaces.ensure_workspace_access") as m_access,
            patch("api.routes.workspaces._roles") as m_roles,
            patch("api.routes.workspaces._svc") as m_workspaces,
        ):
            m_access.return_value = None
            m_roles.return_value.get.side_effect = HTTPException(
                status_code=404,
                detail="role not found",
            )

            response = client.get(
                f"/api/workspaces/{workspace_id}/roles/web-app-does-not-exist/app-config",
                headers=self._csrf_headers(client),
            )

        self.assertEqual(response.status_code, 404)
        self.assertIn("role not found", response.text)
        m_workspaces.return_value.read_role_app_config.assert_not_called()


if __name__ == "__main__":
    unittest.main()
