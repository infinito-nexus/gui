from ._workspace_service_refactor_support import *  # noqa: F403


class TestWorkspaceServiceRefactorPart3(WorkspaceServiceRefactorTestCase):
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
