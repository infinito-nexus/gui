from ._workspace_service_refactor_support import *  # noqa: F403


class TestWorkspaceServiceRefactorPart2(WorkspaceServiceRefactorTestCase):
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
                "services.workspaces.mixins.artifacts.main._vault_password_from_kdbx",
                return_value="derived-vault-pass",
            ),
            patch.object(service, "_history_commit"),
            patch(
                "services.workspaces.mixins.artifacts.main.subprocess.run",
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
                "services.workspaces.mixins.artifacts.main._vault_password_from_kdbx",
                return_value="derived-vault-pass",
            ),
            patch.object(service, "_history_commit"),
            patch(
                "services.workspaces.mixins.artifacts.main.subprocess.run",
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
                "services.workspaces.mixins.artifacts.main._vault_password_from_kdbx",
                return_value="derived-vault-pass",
            ),
            patch.object(service, "_history_commit"),
            patch(
                "services.workspaces.mixins.artifacts.main.subprocess.run",
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
