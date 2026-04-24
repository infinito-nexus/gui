from __future__ import annotations

import os
import subprocess
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi import HTTPException
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

    def test_write_file_preserves_existing_host_var_applications(self) -> None:
        service = WorkspaceService()
        created = service.create(owner_id="user-1")
        workspace_id = str(created["workspace_id"])

        service.write_file(
            workspace_id,
            "host_vars/device.yml",
            (
                "ansible_host: ssh-password\n"
                "applications:\n"
                "  web-app-dashboard:\n"
                "    compose:\n"
                "      services:\n"
                "        dashboard:\n"
                "          enabled: true\n"
                "    credentials:\n"
                "      oauth2_proxy_cookie_secret: !vault |\n"
                "        $ANSIBLE_VAULT;1.1;AES256\n"
                "        deadbeef\n"
                "  svc-db-mariadb:\n"
                "    credentials:\n"
                "      root_password: !vault |\n"
                "        $ANSIBLE_VAULT;1.1;AES256\n"
                "        cafebabe\n"
            ),
        )

        service.write_file(
            workspace_id,
            "host_vars/device.yml",
            (
                "ansible_host: ssh-password\n"
                "ansible_user: deploy\n"
                "applications:\n"
                "  web-app-dashboard:\n"
                "    compose:\n"
                "      services:\n"
                "        dashboard:\n"
                "          enabled: true\n"
            ),
        )

        updated = service.read_file(workspace_id, "host_vars/device.yml")

        self.assertIn("ansible_user: deploy\n", updated)
        self.assertIn("web-app-dashboard:\n", updated)
        self.assertIn("oauth2_proxy_cookie_secret: !vault |", updated)
        self.assertIn("svc-db-mariadb:\n", updated)
        self.assertIn("root_password: !vault |", updated)

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

    def test_generate_credentials_sets_cli_home_and_ansible_temp(self) -> None:
        service = WorkspaceService()
        created = service.create(owner_id="user-1")
        workspace_id = str(created["workspace_id"])
        service.upsert_server_connection(
            workspace_id,
            alias="device",
            host="ssh-password",
            user="deploy",
            port=22,
        )

        repo_tmp = TemporaryDirectory()
        self.addCleanup(repo_tmp.cleanup)
        repo_root = Path(repo_tmp.name)
        (repo_root / "roles" / "web-app-dashboard").mkdir(parents=True)

        captured: dict[str, str] = {}

        def _fake_run(*args, **kwargs):
            env = kwargs["env"]
            captured["HOME"] = env["HOME"]
            captured["TMPDIR"] = env["TMPDIR"]
            captured["XDG_CACHE_HOME"] = env["XDG_CACHE_HOME"]
            captured["ANSIBLE_LOCAL_TEMP"] = env["ANSIBLE_LOCAL_TEMP"]
            captured["PYTHONPATH"] = env["PYTHONPATH"]
            for key in ("HOME", "TMPDIR", "XDG_CACHE_HOME", "ANSIBLE_LOCAL_TEMP"):
                self.assertTrue(Path(env[key]).is_dir(), key)
            self.assertTrue(
                Path(env["ANSIBLE_LOCAL_TEMP"]).is_relative_to(Path(env["HOME"])),
            )
            return subprocess.CompletedProcess(args[0], 0, "", "")

        with (
            patch.dict(os.environ, {"INFINITO_REPO_PATH": str(repo_root)}, clear=False),
            patch(
                "services.workspaces.workspace_service_artifacts._vault_password_from_kdbx",
                return_value="derived-vault-pass",
            ),
            patch.object(service, "_history_commit"),
            patch(
                "services.workspaces.workspace_service_artifacts.subprocess.run",
                side_effect=_fake_run,
            ),
        ):
            service.generate_credentials(
                workspace_id,
                master_password="vault-pass-014",
                selected_roles=["web-app-dashboard"],
                allow_empty_plain=False,
                set_values=None,
                force=False,
                alias="device",
            )

        self.assertIn(str(repo_root), captured["PYTHONPATH"])

    def test_generate_credentials_stages_vault_password_in_tmpfs(self) -> None:
        service = WorkspaceService()
        created = service.create(owner_id="user-1")
        workspace_id = str(created["workspace_id"])
        service.upsert_server_connection(
            workspace_id,
            alias="device",
            host="ssh-password",
            user="deploy",
            port=22,
        )

        repo_tmp = TemporaryDirectory()
        self.addCleanup(repo_tmp.cleanup)
        repo_root = Path(repo_tmp.name)
        (repo_root / "roles" / "web-app-dashboard").mkdir(parents=True)

        captured: dict[str, object] = {}

        def _fake_run(*args, **kwargs):
            command = list(args[0])
            vault_index = command.index("--vault-password-file") + 1
            vault_path = Path(command[vault_index])

            captured["vault_path"] = str(vault_path)
            self.assertRegex(
                str(vault_path), r"^/dev/shm/workspace-secret-[^/]+/vault_password$"
            )
            self.assertEqual(
                vault_path.read_text(encoding="utf-8"), "derived-vault-pass"
            )
            self.assertEqual(vault_path.stat().st_mode & 0o777, 0o400)
            return subprocess.CompletedProcess(args[0], 0, "", "")

        with (
            patch.dict(os.environ, {"INFINITO_REPO_PATH": str(repo_root)}, clear=False),
            patch(
                "services.workspaces.workspace_service_artifacts._vault_password_from_kdbx",
                return_value="derived-vault-pass",
            ),
            patch.object(service, "_history_commit"),
            patch(
                "services.workspaces.workspace_service_artifacts.subprocess.run",
                side_effect=_fake_run,
            ),
        ):
            service.generate_credentials(
                workspace_id,
                master_password="vault-pass-014",
                selected_roles=["web-app-dashboard"],
                allow_empty_plain=False,
                set_values=None,
                force=False,
                alias="device",
            )

        self.assertRegex(
            str(captured["vault_path"]),
            r"^/dev/shm/workspace-secret-[^/]+/vault_password$",
        )
        self.assertFalse(Path(str(captured["vault_path"])).exists())

    def test_generate_credentials_expands_enabled_shared_service_roles(self) -> None:
        service = WorkspaceService()
        created = service.create(owner_id="user-1")
        workspace_id = str(created["workspace_id"])
        service.upsert_server_connection(
            workspace_id,
            alias="device",
            host="ssh-password",
            user="deploy",
            port=22,
        )
        service.write_file(
            workspace_id,
            "group_vars/all.yml",
            (
                "applications:\n"
                "  web-app-dashboard:\n"
                "    compose:\n"
                "      services:\n"
                "        oidc:\n"
                "          enabled: false\n"
            ),
        )

        repo_tmp = TemporaryDirectory()
        self.addCleanup(repo_tmp.cleanup)
        repo_root = Path(repo_tmp.name)

        dashboard_config = repo_root / "roles" / "web-app-dashboard" / "config"
        dashboard_config.mkdir(parents=True, exist_ok=True)
        (dashboard_config / "main.yml").write_text(
            "compose:\n"
            "  services:\n"
            "    prometheus:\n"
            "      enabled: true\n"
            "      shared: true\n"
            "    oidc:\n"
            "      enabled: true\n"
            "      shared: true\n",
            encoding="utf-8",
        )

        prometheus_config = repo_root / "roles" / "web-app-prometheus" / "config"
        prometheus_config.mkdir(parents=True, exist_ok=True)
        (prometheus_config / "main.yml").write_text(
            "compose:\n"
            "  services:\n"
            "    prometheus:\n"
            "      enabled: false\n"
            "      shared: true\n"
            "    mariadb:\n"
            "      enabled: true\n"
            "      shared: true\n",
            encoding="utf-8",
        )

        oidc_config = repo_root / "roles" / "web-app-oidc" / "config"
        oidc_config.mkdir(parents=True, exist_ok=True)
        (oidc_config / "main.yml").write_text(
            "compose:\n"
            "  services:\n"
            "    oidc:\n"
            "      enabled: false\n"
            "      shared: true\n",
            encoding="utf-8",
        )

        mariadb_config = repo_root / "roles" / "svc-db-mariadb" / "config"
        mariadb_config.mkdir(parents=True, exist_ok=True)
        (mariadb_config / "main.yml").write_text(
            "compose:\n"
            "  services:\n"
            "    mariadb:\n"
            "      enabled: false\n"
            "      shared: true\n",
            encoding="utf-8",
        )

        invoked_roles: list[str] = []

        def _fake_run(*args, **kwargs):
            command = list(args[0])
            role_index = command.index("--role-path") + 1
            invoked_roles.append(Path(command[role_index]).name)
            return subprocess.CompletedProcess(args[0], 0, "", "")

        with (
            patch.dict(os.environ, {"INFINITO_REPO_PATH": str(repo_root)}, clear=False),
            patch(
                "services.workspaces.workspace_service_artifacts._vault_password_from_kdbx",
                return_value="derived-vault-pass",
            ),
            patch.object(service, "_history_commit"),
            patch(
                "services.workspaces.workspace_service_artifacts.subprocess.run",
                side_effect=_fake_run,
            ),
        ):
            service.generate_credentials(
                workspace_id,
                master_password="vault-pass-014",
                selected_roles=["web-app-dashboard"],
                allow_empty_plain=False,
                set_values=None,
                force=False,
                alias="device",
            )

        self.assertEqual(
            invoked_roles,
            [
                "web-app-dashboard",
                "web-app-prometheus",
                "svc-db-mariadb",
            ],
        )

    def test_generate_credentials_tmpfs_vault_file_survives_grandchild_process(
        self,
    ) -> None:
        service = WorkspaceService()
        created = service.create(owner_id="user-1")
        workspace_id = str(created["workspace_id"])
        service.upsert_server_connection(
            workspace_id,
            alias="device",
            host="ssh-password",
            user="deploy",
            port=22,
        )

        repo_tmp = TemporaryDirectory()
        self.addCleanup(repo_tmp.cleanup)
        repo_root = Path(repo_tmp.name)
        (repo_root / "roles" / "web-app-dashboard").mkdir(parents=True)
        (repo_root / "cli" / "create" / "credentials").mkdir(parents=True)
        for package_init in (
            repo_root / "cli" / "__init__.py",
            repo_root / "cli" / "create" / "__init__.py",
            repo_root / "cli" / "create" / "credentials" / "__init__.py",
        ):
            package_init.write_text("", encoding="utf-8")
        (repo_root / "cli" / "create" / "credentials" / "__main__.py").write_text(
            "\n".join(
                [
                    "import argparse",
                    "import subprocess",
                    "import sys",
                    "",
                    "parser = argparse.ArgumentParser()",
                    "parser.add_argument('--role-path', required=True)",
                    "parser.add_argument('--inventory-file', required=True)",
                    "parser.add_argument('--vault-password-file', required=True)",
                    "parser.add_argument('--allow-empty-plain', action='store_true')",
                    "parser.add_argument('--force', action='store_true')",
                    "parser.add_argument('--yes', action='store_true')",
                    "parser.add_argument('--set', action='append', default=[])",
                    "args = parser.parse_args()",
                    "result = subprocess.run(",
                    "    [",
                    "        sys.executable,",
                    "        '-c',",
                    "        \"from pathlib import Path; import sys; sys.stdout.write(Path(sys.argv[1]).read_text(encoding='utf-8'))\",",
                    "        args.vault_password_file,",
                    "    ],",
                    "    capture_output=True,",
                    "    text=True,",
                    "    check=False,",
                    ")",
                    "if result.returncode != 0:",
                    "    sys.stderr.write(result.stderr or 'grandchild failed')",
                    "    raise SystemExit(result.returncode)",
                    "if result.stdout != 'derived-vault-pass':",
                    "    sys.stderr.write(f'unexpected vault contents: {result.stdout!r}')",
                    "    raise SystemExit(1)",
                ]
            )
            + "\n",
            encoding="utf-8",
        )

        with (
            patch.dict(os.environ, {"INFINITO_REPO_PATH": str(repo_root)}, clear=False),
            patch(
                "services.workspaces.workspace_service_artifacts._vault_password_from_kdbx",
                return_value="derived-vault-pass",
            ),
            patch.object(service, "_history_commit"),
        ):
            service.generate_credentials(
                workspace_id,
                master_password="vault-pass-014",
                selected_roles=["web-app-dashboard"],
                allow_empty_plain=False,
                set_values=None,
                force=False,
                alias="device",
            )

    def test_generate_credentials_includes_cli_error_summary(self) -> None:
        service = WorkspaceService()
        created = service.create(owner_id="user-1")
        workspace_id = str(created["workspace_id"])
        service.upsert_server_connection(
            workspace_id,
            alias="device",
            host="ssh-password",
            user="deploy",
            port=22,
        )

        repo_tmp = TemporaryDirectory()
        self.addCleanup(repo_tmp.cleanup)
        repo_root = Path(repo_tmp.name)
        (repo_root / "roles" / "web-app-dashboard").mkdir(parents=True)

        with (
            patch.dict(os.environ, {"INFINITO_REPO_PATH": str(repo_root)}, clear=False),
            patch(
                "services.workspaces.workspace_service_artifacts._vault_password_from_kdbx",
                return_value="derived-vault-pass",
            ),
            patch.object(service, "_history_commit"),
            patch(
                "services.workspaces.workspace_service_artifacts.subprocess.run",
                return_value=subprocess.CompletedProcess(
                    args=["python", "-m", "cli.create.credentials"],
                    returncode=1,
                    stdout="",
                    stderr=(
                        "Traceback (most recent call last):\n"
                        "ERROR: Unable to create local directories '/home/api/.ansible/tmp'\n"
                    ),
                ),
            ),
        ):
            with self.assertRaises(HTTPException) as ctx:
                service.generate_credentials(
                    workspace_id,
                    master_password="vault-pass-014",
                    selected_roles=["web-app-dashboard"],
                    allow_empty_plain=False,
                    set_values=None,
                    force=False,
                    alias="device",
                )

        self.assertEqual(ctx.exception.status_code, 500)
        self.assertIn(
            "credential generation failed for web-app-dashboard", ctx.exception.detail
        )
        self.assertIn("ERROR: Unable to create local directories", ctx.exception.detail)

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
