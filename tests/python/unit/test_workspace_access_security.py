from __future__ import annotations

import importlib
import os
import re
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile
from io import BytesIO

from fastapi import HTTPException
from fastapi.testclient import TestClient
from services.workspaces import (
    workspace_context,
    workspace_service_artifacts,
    workspace_service_history,
    workspace_service_history_restore,
    workspace_service_inventory,
    workspace_service_management,
)


_UUID4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)


class TestWorkspaceAccessSecurity(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._saved_env = {
            key: os.environ.get(key)
            for key in (
                "ALLOWED_ORIGINS",
                "AUTH_PROXY_ENABLED",
                "AUTH_PROXY_USER_HEADER",
                "CORS_ALLOW_ORIGINS",
                "STATE_DIR",
            )
        }
        os.environ["STATE_DIR"] = self._tmp.name
        os.environ["ALLOWED_ORIGINS"] = "http://127.0.0.1:3000"
        os.environ["CORS_ALLOW_ORIGINS"] = ""
        os.environ["AUTH_PROXY_ENABLED"] = "true"
        os.environ["AUTH_PROXY_USER_HEADER"] = "X-Auth-Request-User"

    def tearDown(self) -> None:
        for key, value in self._saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def _client(self) -> TestClient:
        main_module = importlib.import_module("main")
        return TestClient(main_module.create_app())

    def _create_workspace(self, client: TestClient, user: str) -> str:
        response = client.post(
            "/api/workspaces",
            headers={"X-Auth-Request-User": user},
        )
        self.assertEqual(response.status_code, 200)
        return str(response.json()["workspace_id"])

    def test_workspace_create_returns_uuid4_id(self) -> None:
        client = self._client()
        response = client.post("/api/workspaces", headers={"X-Auth-Request-User": "alice"})

        self.assertEqual(response.status_code, 200)
        workspace_id = str(response.json().get("workspace_id") or "")
        self.assertRegex(workspace_id, _UUID4_RE)

    def test_oauth_owner_mismatch_returns_404(self) -> None:
        client = self._client()
        workspace_id = self._create_workspace(client, "alice")

        denied = client.get(
            f"/api/workspaces/{workspace_id}/files",
            headers={"X-Auth-Request-User": "bob"},
        )

        self.assertEqual(denied.status_code, 404)
        self.assertIn("workspace not found", denied.text)

    def test_symlink_escape_is_rejected_via_workspace_file_api(self) -> None:
        client = self._client()
        workspace_id = self._create_workspace(client, "alice")
        workspace_root = Path(self._tmp.name) / "workspaces" / workspace_id

        outside = Path(self._tmp.name) / "outside-secret.txt"
        outside.write_text("outside\n", encoding="utf-8")
        (workspace_root / "escape.txt").symlink_to(outside)

        response = client.get(
            f"/api/workspaces/{workspace_id}/files/escape.txt",
            headers={"X-Auth-Request-User": "alice"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("invalid path", response.text)

    def test_safe_resolve_rejects_absolute_and_parent_escape_paths(self) -> None:
        root = Path(self._tmp.name) / "workspace-root"
        root.mkdir(parents=True, exist_ok=True)

        with self.assertRaises(HTTPException) as abs_ctx:
            workspace_context._safe_resolve(root, "/etc/passwd")
        with self.assertRaises(HTTPException) as parent_ctx:
            workspace_context._safe_resolve(root, "../outside.txt")

        self.assertEqual(abs_ctx.exception.status_code, 400)
        self.assertEqual(parent_ctx.exception.status_code, 400)

    def test_workspace_services_share_single_path_safety_helper(self) -> None:
        shared = workspace_context._safe_resolve

        self.assertIs(workspace_service_management._safe_resolve, shared)
        self.assertIs(workspace_service_artifacts._safe_resolve, shared)
        self.assertIs(workspace_service_inventory._safe_resolve, shared)
        self.assertIs(workspace_service_history._safe_resolve, shared)
        self.assertIs(workspace_service_history_restore._safe_resolve, shared)

    def test_cross_workspace_file_operations_hide_target_workspace_existence(
        self,
    ) -> None:
        client = self._client()
        workspace_id = self._create_workspace(client, "bob")

        responses = [
            client.get(
                f"/api/workspaces/{workspace_id}/files",
                headers={"X-Auth-Request-User": "alice"},
            ),
            client.get(
                f"/api/workspaces/{workspace_id}/files/notes.txt",
                headers={"X-Auth-Request-User": "alice"},
            ),
            client.put(
                f"/api/workspaces/{workspace_id}/files/notes.txt",
                json={"content": "hello"},
                headers={"X-Auth-Request-User": "alice"},
            ),
            client.post(
                f"/api/workspaces/{workspace_id}/files/notes.txt/rename",
                json={"new_path": "renamed.txt"},
                headers={"X-Auth-Request-User": "alice"},
            ),
            client.delete(
                f"/api/workspaces/{workspace_id}/files/notes.txt",
                headers={"X-Auth-Request-User": "alice"},
            ),
        ]

        for response in responses:
            self.assertEqual(response.status_code, 404)
            self.assertIn("workspace not found", response.text)

    def test_cross_workspace_zip_inventory_and_credentials_endpoints_hide_existence(
        self,
    ) -> None:
        client = self._client()
        workspace_id = self._create_workspace(client, "bob")

        zip_buffer = BytesIO()
        with ZipFile(zip_buffer, "w") as archive:
            archive.writestr("notes.txt", "hello\n")
        zip_payload = zip_buffer.getvalue()

        inventory_preview = client.post(
            "/api/inventories/preview",
            json={
                "workspace_id": workspace_id,
                "host": "ssh-password",
                "port": 22,
                "user": "deploy",
                "auth": {"method": "password", "password": "deploy"},
                "selected_roles": ["web-app-dashboard"],
            },
            headers={"X-Auth-Request-User": "alice"},
        )
        credentials = client.post(
            f"/api/workspaces/{workspace_id}/credentials",
            json={"master_password": "secret", "selected_roles": ["web-app-dashboard"]},
            headers={"X-Auth-Request-User": "alice"},
        )
        download_zip = client.get(
            f"/api/workspaces/{workspace_id}/download.zip",
            headers={"X-Auth-Request-User": "alice"},
        )
        upload_preview = client.post(
            f"/api/workspaces/{workspace_id}/upload.zip/preview",
            headers={"X-Auth-Request-User": "alice"},
            files={"file": ("workspace.zip", zip_payload, "application/zip")},
        )

        for response in (
            inventory_preview,
            credentials,
            download_zip,
            upload_preview,
        ):
            self.assertEqual(response.status_code, 404)
            self.assertIn("workspace not found", response.text)


if __name__ == "__main__":
    unittest.main()
