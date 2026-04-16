from __future__ import annotations

import os
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from services.workspaces import WorkspaceService


class TestWorkspaceServiceRefactor(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._old_state_dir = os.environ.get("STATE_DIR")
        os.environ["STATE_DIR"] = self._tmp.name

    def tearDown(self) -> None:
        if self._old_state_dir is None:
            os.environ.pop("STATE_DIR", None)
        else:
            os.environ["STATE_DIR"] = self._old_state_dir

    def test_create_initializes_expected_workspace_layout(self) -> None:
        service = WorkspaceService()
        created = service.create(owner_id="user-1", owner_email="user@example.com")
        workspace_id = str(created["workspace_id"])
        root = Path(self._tmp.name) / "workspaces" / workspace_id

        self.assertTrue(root.is_dir())
        self.assertTrue((root / "host_vars").is_dir())
        self.assertTrue((root / "group_vars").is_dir())
        self.assertTrue((root / "secrets").is_dir())
        self.assertTrue((root / "secrets" / "keys").is_dir())
        self.assertEqual(created["state"], "draft")
        self.assertEqual(created["owner_id"], "user-1")

    def test_list_files_does_not_include_workspace_metadata_file(self) -> None:
        service = WorkspaceService()
        created = service.create(owner_id="user-1")
        workspace_id = str(created["workspace_id"])

        service.write_file(workspace_id, "inventory.yml", "all:\n  hosts: {}\n")
        entries = service.list_files(workspace_id)
        paths = {str(item.get("path") or "") for item in entries}

        self.assertIn("host_vars", paths)
        self.assertIn("group_vars", paths)
        self.assertIn("secrets", paths)
        self.assertIn("secrets/keys", paths)
        self.assertIn("inventory.yml", paths)
        self.assertNotIn("workspace.json", paths)

    def test_write_and_read_file_roundtrip(self) -> None:
        service = WorkspaceService()
        created = service.create(owner_id="user-1")
        workspace_id = str(created["workspace_id"])

        content = "line-a\nline-b\n"
        service.write_file(workspace_id, "group_vars/all.yml", content)
        loaded = service.read_file(workspace_id, "group_vars/all.yml")

        self.assertEqual(loaded, content)

    def test_runtime_settings_default_to_latest_and_accept_stable_semver(self) -> None:
        service = WorkspaceService()
        created = service.create(owner_id="user-1")
        workspace_id = str(created["workspace_id"])

        initial = service.get_runtime_settings(workspace_id)
        updated = service.update_runtime_settings(
            workspace_id,
            infinito_nexus_version="v5.2.0",
        )
        loaded = service.get_runtime_settings(workspace_id)

        self.assertEqual(initial["infinito_nexus_version"], "latest")
        self.assertEqual(updated["infinito_nexus_version"], "5.2.0")
        self.assertEqual(loaded["infinito_nexus_version"], "5.2.0")

    def test_upsert_server_connection_updates_host_vars_and_preserves_vault_blocks(
        self,
    ) -> None:
        service = WorkspaceService()
        created = service.create(owner_id="user-1")
        workspace_id = str(created["workspace_id"])

        service.write_file(
            workspace_id,
            "host_vars/device.yml",
            (
                "ansible_host: old-host\n"
                "ansible_user: root\n"
                "ansible_password: !vault |\n"
                "  $ANSIBLE_VAULT;1.1;AES256\n"
                "  deadbeefdeadbeefdeadbeefdeadbeef\n"
            ),
        )

        result = service.upsert_server_connection(
            workspace_id,
            alias="device",
            host="ssh-password",
            user="deploy",
            port=22,
        )

        updated = service.read_file(workspace_id, "host_vars/device.yml")
        inventory = service.read_file(workspace_id, "inventory.yml")

        self.assertEqual(result["alias"], "device")
        self.assertEqual(result["host"], "ssh-password")
        self.assertEqual(result["user"], "deploy")
        self.assertEqual(result["port"], 22)
        self.assertEqual(result["host_vars_path"], "host_vars/device.yml")
        self.assertIn("ansible_host: ssh-password\n", updated)
        self.assertIn("ansible_user: deploy\n", updated)
        self.assertIn("ansible_port: 22\n", updated)
        self.assertIn("ansible_password: !vault |", updated)
        self.assertIn("$ANSIBLE_VAULT;1.1;AES256\n", updated)
        self.assertIn("device: {}", inventory)

    def test_workspace_write_lock_serializes_same_workspace_across_threads(
        self,
    ) -> None:
        service = WorkspaceService()
        acquired = threading.Event()

        def _worker() -> None:
            with service.workspace_write_lock("ws-1"):
                acquired.set()

        with service.workspace_write_lock("ws-1"):
            worker = threading.Thread(target=_worker)
            worker.start()
            self.assertFalse(acquired.wait(timeout=0.1))

        worker.join(timeout=1)
        self.assertTrue(acquired.is_set())

    def test_workspace_write_lock_is_reentrant_for_same_thread(self) -> None:
        service = WorkspaceService()

        with service.workspace_write_lock("ws-1"):
            with service.workspace_write_lock("ws-1"):
                self.assertTrue(True)

    def test_workspace_write_lock_serializes_across_service_instances(self) -> None:
        service_a = WorkspaceService()
        service_b = WorkspaceService()
        acquired = threading.Event()

        def _worker() -> None:
            with service_b.workspace_write_lock("ws-shared"):
                acquired.set()

        with service_a.workspace_write_lock("ws-shared"):
            worker = threading.Thread(target=_worker)
            worker.start()
            self.assertFalse(acquired.wait(timeout=0.1))

        worker.join(timeout=1)
        self.assertTrue(acquired.is_set())

    def test_concurrent_server_and_domain_updates_preserve_both_changes(self) -> None:
        service = WorkspaceService()
        created = service.create(owner_id="user-1")
        workspace_id = str(created["workspace_id"])
        service.write_file(workspace_id, "host_vars/device.yml", "ansible_host: old\n")

        exceptions: list[BaseException] = []

        def _set_domain() -> None:
            try:
                service.set_primary_domain(
                    workspace_id,
                    alias="device",
                    primary_domain="dashboard.local",
                )
            except BaseException as exc:  # pragma: no cover - defensive collection
                exceptions.append(exc)

        def _set_connection() -> None:
            try:
                service.upsert_server_connection(
                    workspace_id,
                    alias="device",
                    host="ssh-password",
                    user="deploy",
                    port=22,
                )
            except BaseException as exc:  # pragma: no cover - defensive collection
                exceptions.append(exc)

        thread_a = threading.Thread(target=_set_domain)
        thread_b = threading.Thread(target=_set_connection)
        thread_a.start()
        thread_b.start()
        thread_a.join(timeout=2)
        thread_b.join(timeout=2)

        self.assertFalse(exceptions)
        updated = service.read_file(workspace_id, "host_vars/device.yml")
        self.assertIn("DOMAIN_PRIMARY: dashboard.local\n", updated)
        self.assertIn("ansible_host: ssh-password\n", updated)
        self.assertIn("ansible_user: deploy\n", updated)
        self.assertIn("ansible_port: 22\n", updated)

    @unittest.skipUnless(
        Path(os.environ.get("INFINITO_REPO_PATH", "") or "/nonexistent").is_dir()
        and (
            Path(os.environ.get("INFINITO_REPO_PATH", "") or "/nonexistent")
            / "cli"
            / "create"
            / "inventory"
            / "host_vars.py"
        ).is_file(),
        "requires a real infinito-nexus checkout at INFINITO_REPO_PATH",
    )
    def test_concurrent_inventory_and_connection_updates_do_not_leave_git_lock(
        self,
    ) -> None:
        service = WorkspaceService()
        created = service.create(owner_id="user-1")
        workspace_id = str(created["workspace_id"])

        exceptions: list[BaseException] = []

        def _generate_inventory() -> None:
            try:
                service.generate_inventory(
                    workspace_id,
                    {
                        "alias": "device",
                        "host": "ssh-password",
                        "port": 22,
                        "user": "deploy",
                        "auth_method": "password",
                        "selected_roles": ["web-app-dashboard"],
                    },
                )
            except BaseException as exc:  # pragma: no cover - defensive collection
                exceptions.append(exc)

        def _set_connection() -> None:
            try:
                service.upsert_server_connection(
                    workspace_id,
                    alias="device",
                    host="ssh-password",
                    user="deploy",
                    port=22,
                )
            except BaseException as exc:  # pragma: no cover - defensive collection
                exceptions.append(exc)

        thread_a = threading.Thread(target=_generate_inventory)
        thread_b = threading.Thread(target=_set_connection)
        thread_a.start()
        thread_b.start()
        thread_a.join(timeout=2)
        thread_b.join(timeout=2)

        self.assertFalse(exceptions)
        root = service.ensure(workspace_id)
        self.assertFalse((root / ".git" / "index.lock").exists())
        self.assertEqual(
            service.read_file(workspace_id, "host_vars/device.yml").count(
                "ansible_host:"
            ),
            1,
        )


if __name__ == "__main__":
    unittest.main()
