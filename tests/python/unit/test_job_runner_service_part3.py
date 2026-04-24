from ._job_runner_service_support import *  # noqa: F403


class TestJobRunnerServicePart3(JobRunnerServiceTestCase):
    @patch("services.job_runner.service.build_inventory_preview")
    def test_persisted_files_mask_secrets(self, m_preview) -> None:
        m_preview.return_value = (
            "all:\n  hosts:\n    localhost:\n      vars: {}\n",
            [],
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433

        svc = JobRunnerService()
        job = svc.create(req=self._secret_request())

        request_text = Path(job.request_path).read_text(encoding="utf-8")
        vars_json = (Path(job.workspace_dir) / "vars.json").read_text(encoding="utf-8")
        vars_yaml = (Path(job.workspace_dir) / "vars.yml").read_text(encoding="utf-8")

        for secret in ("supersecret", "vault-master"):
            self.assertNotIn(secret, request_text)
            self.assertNotIn(secret, vars_json)
            self.assertNotIn(secret, vars_yaml)

    def test_create_requires_master_password_for_vaulted_workspace(self) -> None:
        host_vars_dir = (
            Path(self._tmp.name) / "workspaces" / self.workspace_id / "host_vars"
        )
        host_vars_dir.mkdir(parents=True, exist_ok=True)
        (host_vars_dir / "device.yml").write_text(
            "applications:\n"
            "  web-app-dashboard:\n"
            "    credentials:\n"
            "      admin_password: !vault |\n"
            "        $ANSIBLE_VAULT;1.1;AES256\n"
            "        deadbeef\n",
            encoding="utf-8",
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433
        from fastapi import HTTPException  # noqa: WPS433

        svc = JobRunnerService()
        with self.assertRaises(HTTPException) as ctx:
            svc.create(req=self._minimal_request())

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("master_password is required", str(ctx.exception.detail))

    @patch("services.job_runner.service._vault_password_from_kdbx")
    @patch("services.job_runner.service.build_container_command")
    @patch("services.job_runner.service.load_container_config")
    def test_create_passes_runtime_vault_password_for_vaulted_workspace(
        self,
        m_load_container_config,
        m_build_container_command,
        m_vault_password,
    ) -> None:
        host_vars_dir = (
            Path(self._tmp.name) / "workspaces" / self.workspace_id / "host_vars"
        )
        host_vars_dir.mkdir(parents=True, exist_ok=True)
        (host_vars_dir / "device.yml").write_text(
            "applications:\n"
            "  web-app-dashboard:\n"
            "    credentials:\n"
            "      admin_password: !vault |\n"
            "        $ANSIBLE_VAULT;1.1;AES256\n"
            "        deadbeef\n",
            encoding="utf-8",
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433
        from services.job_runner.container_runner import ContainerRunnerConfig  # noqa: WPS433
        from api.schemas.deployment import DeploymentRequest  # noqa: WPS433

        old_runner_cmd = os.environ.get("RUNNER_CMD")
        os.environ.pop("RUNNER_CMD", None)
        self.addCleanup(
            lambda: (
                os.environ.pop("RUNNER_CMD", None)
                if old_runner_cmd is None
                else os.environ.__setitem__("RUNNER_CMD", old_runner_cmd)
            )
        )

        m_vault_password.return_value = "derived-vault-pass"
        m_load_container_config.return_value = ContainerRunnerConfig(
            image=_PINNED_RUNNER_IMAGE,
            repo_dir="/opt/src/infinito",
            workdir="/workspace",
            network=None,
            extra_args=[],
            skip_cleanup=False,
            skip_build=False,
        )
        m_build_container_command.return_value = (
            ["true"],
            "container-id",
            m_load_container_config.return_value,
        )

        req = DeploymentRequest(
            workspace_id=self.workspace_id,
            host="localhost",
            user="tester",
            auth={"method": "password", "password": "supersecret"},
            master_password="vault-master",
            selected_roles=["example-role"],
        )

        svc = JobRunnerService()
        job = svc.create(req=req)
        self._wait_for_terminal(svc, job.job_id)

        self.assertTrue(m_build_container_command.called)
        runtime_env = m_build_container_command.call_args.kwargs["runtime_env"]
        self.assertEqual(
            runtime_env["INFINITO_RUNTIME_VAULT_PASSWORD"], "derived-vault-pass"
        )
        self.assertEqual(runtime_env["INFINITO_RUNTIME_PASSWORD"], "supersecret")
        self.assertEqual(runtime_env["INFINITO_RUNTIME_SSH_PASS"], "supersecret")

        self._wait_for_terminal(svc, job.job_id)

    @patch("services.job_runner.service.RunnerManagerClient")
    @patch("services.job_runner.service.load_container_config")
    def test_runner_manager_mode_writes_control_and_secret_files(
        self,
        m_load_container_config,
        m_manager_client,
    ) -> None:
        from services.job_runner import JobRunnerService  # noqa: WPS433
        from services.job_runner.container_runner import (  # noqa: WPS433
            ContainerRunnerConfig,
        )

        old_manager_url = os.environ.get("RUNNER_MANAGER_URL")
        os.environ["RUNNER_MANAGER_URL"] = "http://runner-manager:8001"
        self.addCleanup(
            lambda: (
                os.environ.pop("RUNNER_MANAGER_URL", None)
                if old_manager_url is None
                else os.environ.__setitem__("RUNNER_MANAGER_URL", old_manager_url)
            )
        )
        old_runner_cmd = os.environ.get("RUNNER_CMD")
        os.environ.pop("RUNNER_CMD", None)
        self.addCleanup(
            lambda: (
                os.environ.pop("RUNNER_CMD", None)
                if old_runner_cmd is None
                else os.environ.__setitem__("RUNNER_CMD", old_runner_cmd)
            )
        )

        manager_client = m_manager_client.return_value
        manager_client.enabled.return_value = True
        manager_client.start_job.return_value = None

        m_load_container_config.return_value = ContainerRunnerConfig(
            image=_PINNED_RUNNER_IMAGE,
            repo_dir="/opt/src/infinito",
            workdir="/workspace",
            network="infinito-deployer",
            extra_args=[],
            skip_cleanup=False,
            skip_build=False,
        )
        workspace_kdbx = (
            Path(self._tmp.name)
            / "workspaces"
            / self.workspace_id
            / "secrets"
            / "credentials.kdbx"
        )
        workspace_kdbx.write_bytes(b"KDBX-DATA")
        workspace_group_vars = (
            Path(self._tmp.name)
            / "workspaces"
            / self.workspace_id
            / "group_vars"
            / "all.yml"
        )
        workspace_group_vars.parent.mkdir(parents=True, exist_ok=True)
        workspace_group_vars.write_text(
            "users:\n"
            "  administrator:\n"
            "    authorized_keys:\n"
            "      - ssh-ed25519 AAAATEST infinito-test\n",
            encoding="utf-8",
        )

        svc = JobRunnerService()
        job = svc.create(req=self._secret_request())

        job_dir = Path(job.workspace_dir)
        control = json.loads(
            (job_dir / "runner-control.json").read_text(encoding="utf-8")
        )
        vars_payload = json.loads((job_dir / "vars.json").read_text(encoding="utf-8"))
        host_vars_payload = yaml.safe_load(
            (job_dir / "host_vars" / "localhost.yml").read_text(encoding="utf-8")
        )

        self.assertEqual(control["cli_args"][:3], ["infinito", "deploy", "dedicated"])
        self.assertNotIn("@/workspace/workspace-overrides.yml", control["cli_args"])
        self.assertTrue((job_dir / "secrets" / "ssh_password").is_file())
        self.assertTrue((job_dir / "secrets" / "credentials.kdbx").is_file())
        self.assertEqual(
            (job_dir / "secrets" / "credentials.kdbx").read_bytes(),
            b"KDBX-DATA",
        )
        self.assertTrue((job_dir / "secrets").is_dir())
        self.assertEqual(
            (job_dir / "secrets").stat().st_mode & 0o777,
            0o700,
        )
        self.assertEqual(
            (job_dir / "secrets" / "ssh_password").stat().st_mode & 0o777,
            0o400,
        )
        self.assertEqual(
            (job_dir / "secrets" / "credentials.kdbx").stat().st_mode & 0o777,
            0o400,
        )
        self.assertEqual(vars_payload, {"selected_roles": ["example-role"]})
        self.assertEqual(
            host_vars_payload["users"]["administrator"]["authorized_keys"],
            ["ssh-ed25519 AAAATEST infinito-test"],
        )
        self.assertEqual((job_dir / "runner-sudoers").stat().st_mode & 0o777, 0o440)

        spec = manager_client.start_job.call_args.args[0]
        self.assertRegex(job.job_id, _UUID4_RE)
        self.assertEqual(spec.secrets_dir, str(job_dir / "secrets"))
        self.assertEqual(spec.inventory_path, "inventory.yml")
        self.assertEqual(spec.job_id, job.job_id)
        self.assertEqual(spec.network_name, f"job-{job.job_id}")
