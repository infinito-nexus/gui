import os
import time
import json
import re
import shlex
import subprocess
import unittest
from tempfile import TemporaryDirectory
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import yaml


_UUID4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
_PINNED_RUNNER_IMAGE = "ghcr.io/example/runner@sha256:" + ("a" * 64)


class TestJobRunnerService(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)

        self._old_state_dir = os.environ.get("STATE_DIR")
        os.environ["STATE_DIR"] = self._tmp.name
        self._old_runner_cmd = os.environ.get("RUNNER_CMD")
        os.environ["RUNNER_CMD"] = "true"
        self.workspace_id = "abc123"
        workspace_root = Path(self._tmp.name) / "workspaces" / self.workspace_id
        workspace_root.mkdir(parents=True, exist_ok=True)
        (workspace_root / "inventory.yml").write_text(
            "all:\n  children:\n    example-role:\n      hosts:\n        localhost: {}\n",
            encoding="utf-8",
        )
        secrets_dir = workspace_root / "secrets"
        secrets_dir.mkdir(parents=True, exist_ok=True)
        playbooks_dir = workspace_root / "playbooks"
        playbooks_dir.mkdir(parents=True, exist_ok=True)
        (playbooks_dir / "emit_lines.yml").write_text(
            "- hosts: all\n"
            "  gather_facts: false\n"
            "  tasks:\n"
            "    - ansible.builtin.debug:\n"
            "        msg: perf\n",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        if self._old_state_dir is None:
            os.environ.pop("STATE_DIR", None)
        else:
            os.environ["STATE_DIR"] = self._old_state_dir
        if self._old_runner_cmd is None:
            os.environ.pop("RUNNER_CMD", None)
        else:
            os.environ["RUNNER_CMD"] = self._old_runner_cmd

    def _minimal_request(self):
        from api.schemas.deployment import DeploymentRequest  # noqa: WPS433

        # Adjust fields if your schema differs, but keep it valid.
        return DeploymentRequest(
            workspace_id=self.workspace_id,
            host="localhost",
            user="tester",
            auth={"method": "password", "password": "x"},
            selected_roles=["example-role"],
        )

    def _secret_request(self):
        from api.schemas.deployment import DeploymentRequest  # noqa: WPS433

        return DeploymentRequest(
            workspace_id=self.workspace_id,
            host="localhost",
            user="tester",
            auth={"method": "password", "password": "supersecret"},
            master_password="vault-master",
            selected_roles=["example-role"],
        )

    def _key_request(self):
        from api.schemas.deployment import DeploymentRequest  # noqa: WPS433

        return DeploymentRequest(
            workspace_id=self.workspace_id,
            host="localhost",
            user="tester",
            auth={"method": "private_key", "private_key": "KEYDATA"},
            selected_roles=["example-role"],
        )

    def _playbook_request(self):
        from api.schemas.deployment import DeploymentRequest  # noqa: WPS433

        return DeploymentRequest(
            workspace_id=self.workspace_id,
            host="localhost",
            user="tester",
            auth={"method": "password", "password": "x"},
            selected_roles=[],
            playbook_path="playbooks/emit_lines.yml",
        )

    def _wait_for_terminal(self, svc, job_id: str) -> None:
        for _ in range(200):
            cur = svc.get(job_id)
            if cur.status in {"succeeded", "failed", "canceled"}:
                return
            time.sleep(0.01)

        time.sleep(0.05)

    @patch("services.job_runner.service.build_inventory_preview")
    def test_create_job_creates_files_and_finishes(self, m_preview) -> None:
        m_preview.return_value = (
            "all:\n  hosts:\n    localhost:\n      vars: {}\n",
            [],
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433

        svc = JobRunnerService()
        job = svc.create(req=self._minimal_request())

        self._wait_for_terminal(svc, job.job_id)

        cur = svc.get(job.job_id)
        self.assertIn(cur.status, {"succeeded", "failed"})
        self.assertTrue(os.path.isfile(cur.log_path))
        self.assertTrue(os.path.isfile(cur.inventory_path))
        self.assertTrue(os.path.isfile(cur.request_path))
        self.assertTrue(os.path.isfile(os.path.join(cur.workspace_dir, "vars.json")))
        self.assertTrue(os.path.isfile(os.path.join(cur.workspace_dir, "vars.yml")))
        self.assertTrue(os.path.isfile(os.path.join(cur.workspace_dir, "baudolo-seed")))
        self.assertTrue(
            os.path.isfile(os.path.join(cur.workspace_dir, "runner-passwd"))
        )
        self.assertTrue(os.path.isfile(os.path.join(cur.workspace_dir, "runner-group")))
        self.assertTrue(
            os.path.isfile(os.path.join(cur.workspace_dir, "runner-sudoers"))
        )
        runner_passwd = Path(cur.workspace_dir) / "runner-passwd"
        self.assertIn("/tmp/infinito-home", runner_passwd.read_text(encoding="utf-8"))
        runner_sudoers = Path(cur.workspace_dir) / "runner-sudoers"
        self.assertIn("NOPASSWD:ALL", runner_sudoers.read_text(encoding="utf-8"))

        # Give background thread a tiny window to flush metadata safely
        time.sleep(0.05)

    @patch("services.job_runner.service.build_inventory_preview")
    def test_private_key_writes_key_file(self, m_preview) -> None:
        m_preview.return_value = (
            "all:\n  hosts:\n    localhost:\n      vars: {}\n",
            [],
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433

        old_runner_cmd = os.environ.get("RUNNER_CMD")
        os.environ["RUNNER_CMD"] = "sleep 0.2"
        self.addCleanup(
            lambda: (
                os.environ.pop("RUNNER_CMD", None)
                if old_runner_cmd is None
                else os.environ.__setitem__("RUNNER_CMD", old_runner_cmd)
            )
        )

        svc = JobRunnerService()
        job = svc.create(req=self._key_request())

        key_path = os.path.join(job.workspace_dir, "id_rsa")
        self.assertTrue(os.path.isfile(key_path))

        mode = os.stat(key_path).st_mode & 0o777
        self.assertEqual(mode, 0o600)

        self._wait_for_terminal(svc, job.job_id)

    @patch("services.job_runner.service.build_inventory_preview")
    def test_private_key_removed_after_completion(self, m_preview) -> None:
        m_preview.return_value = (
            "all:\n  hosts:\n    localhost:\n      vars: {}\n",
            [],
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433

        old_runner_cmd = os.environ.get("RUNNER_CMD")
        os.environ["RUNNER_CMD"] = "true"
        self.addCleanup(
            lambda: (
                os.environ.pop("RUNNER_CMD", None)
                if old_runner_cmd is None
                else os.environ.__setitem__("RUNNER_CMD", old_runner_cmd)
            )
        )

        svc = JobRunnerService()
        job = svc.create(req=self._key_request())

        self._wait_for_terminal(svc, job.job_id)

        key_path = os.path.join(job.workspace_dir, "id_rsa")
        self.assertFalse(os.path.exists(key_path))

    @patch("services.job_runner.service.build_inventory_preview")
    def test_jobs_are_isolated(self, m_preview) -> None:
        m_preview.return_value = (
            "all:\n  hosts:\n    localhost:\n      vars: {}\n",
            [],
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433

        svc = JobRunnerService()
        job_a = svc.create(req=self._minimal_request())
        job_b = svc.create(req=self._minimal_request())

        self.assertNotEqual(job_a.job_id, job_b.job_id)
        self.assertNotEqual(job_a.workspace_dir, job_b.workspace_dir)
        self.assertTrue(os.path.isdir(job_a.workspace_dir))
        self.assertTrue(os.path.isdir(job_b.workspace_dir))
        self.assertNotEqual(
            os.path.realpath(job_a.workspace_dir),
            os.path.realpath(job_b.workspace_dir),
        )

        self._wait_for_terminal(svc, job_a.job_id)
        self._wait_for_terminal(svc, job_b.job_id)

    @patch("services.job_runner.service.build_inventory_preview")
    def test_restart_does_not_corrupt_jobs(self, m_preview) -> None:
        m_preview.return_value = (
            "all:\n  hosts:\n    localhost:\n      vars: {}\n",
            [],
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433

        svc = JobRunnerService()
        job = svc.create(req=self._minimal_request())

        # Simulate API restart by creating a fresh service instance.
        svc_restart = JobRunnerService()
        loaded = svc_restart.get(job.job_id)

        self.assertEqual(loaded.job_id, job.job_id)
        self.assertTrue(os.path.isfile(loaded.request_path))
        self.assertTrue(os.path.isfile(loaded.inventory_path))
        self.assertTrue(os.path.isfile(os.path.join(loaded.workspace_dir, "vars.json")))
        self.assertTrue(os.path.isfile(os.path.join(loaded.workspace_dir, "vars.yml")))

        self._wait_for_terminal(svc, job.job_id)

    def test_startup_purges_orphaned_secret_material(self) -> None:
        jobs_root = Path(self._tmp.name) / "jobs"
        job_dir = jobs_root / "orphan-job"
        secrets_dir = job_dir / "secrets"
        secrets_dir.mkdir(parents=True, exist_ok=True)
        (job_dir / "id_rsa").write_text("KEYDATA", encoding="utf-8")
        (secrets_dir / "ssh_password").write_text("supersecret", encoding="utf-8")
        (job_dir / "job.json").write_text(
            json.dumps({"status": "failed", "pid": None}),
            encoding="utf-8",
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433

        JobRunnerService()

        self.assertFalse((job_dir / "id_rsa").exists())
        self.assertFalse(secrets_dir.exists())

    @patch("services.job_runner.service.build_inventory_preview")
    def test_selected_roles_filter_is_kept_in_vars(self, m_preview) -> None:
        m_preview.return_value = (
            "all:\n  hosts:\n    localhost:\n      vars: {}\n",
            [],
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433
        from api.schemas.deployment import DeploymentRequest  # noqa: WPS433

        req = DeploymentRequest(
            workspace_id=self.workspace_id,
            host="localhost",
            user="tester",
            auth={"method": "password", "password": "x"},
            selected_roles=["custom-role-a", "custom-role-b"],
        )

        svc = JobRunnerService()
        job = svc.create(req=req)
        self._wait_for_terminal(svc, job.job_id)

        vars_path = Path(job.workspace_dir) / "vars.json"
        vars_data = json.loads(vars_path.read_text(encoding="utf-8"))
        self.assertEqual(
            vars_data.get("selected_roles"),
            ["custom-role-a", "custom-role-b"],
        )
        self.assertEqual(vars_data.get("ansible_password"), "<provided_at_runtime>")
        self.assertEqual(vars_data.get("ansible_ssh_pass"), "<provided_at_runtime>")
        self.assertEqual(
            vars_data.get("ansible_become_password"), "<provided_at_runtime>"
        )

    @patch("services.job_runner.service.discover_related_role_domains")
    @patch("services.job_runner.service.build_inventory_preview")
    def test_related_role_domains_are_written_to_host_vars(
        self,
        m_preview,
        m_related_domains,
    ) -> None:
        m_preview.return_value = (
            "all:\n  hosts:\n    localhost:\n      vars: {}\n",
            [],
        )
        m_related_domains.return_value = {
            "web-app-matomo": ["matomo.example.test"],
        }
        host_vars_dir = (
            Path(self._tmp.name) / "workspaces" / self.workspace_id / "host_vars"
        )
        host_vars_dir.mkdir(parents=True, exist_ok=True)
        (host_vars_dir / "device.yml").write_text(
            "DOMAIN_PRIMARY: example.test\n",
            encoding="utf-8",
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433

        svc = JobRunnerService()
        job = svc.create(req=self._minimal_request())
        self._wait_for_terminal(svc, job.job_id)

        host_vars_path = Path(job.workspace_dir) / "host_vars" / "device.yml"
        host_vars_data = yaml.safe_load(host_vars_path.read_text(encoding="utf-8"))
        self.assertEqual(
            host_vars_data.get("domains"),
            {"web-app-matomo": ["matomo.example.test"]},
        )
        self.assertEqual(
            m_related_domains.call_args.kwargs["domain_primary"],
            "example.test",
        )

    def test_build_runner_args_appends_ansible_passthrough_from_env(self) -> None:
        from services.job_runner import JobRunnerService  # noqa: WPS433

        old_extra_args = os.environ.get("JOB_RUNNER_ANSIBLE_ARGS")
        os.environ["JOB_RUNNER_ANSIBLE_ARGS"] = (
            '-e \'{"TLS_ENABLED": false, "TLS_MODE": "letsencrypt"}\' '
            "-e SYS_SVC_SSHD_PASSWORD_AUTHENTICATION=true"
        )
        self.addCleanup(
            lambda: (
                os.environ.pop("JOB_RUNNER_ANSIBLE_ARGS", None)
                if old_extra_args is None
                else os.environ.__setitem__("JOB_RUNNER_ANSIBLE_ARGS", old_extra_args)
            )
        )

        svc = JobRunnerService()
        vars_path = (
            Path(self._tmp.name) / "workspaces" / self.workspace_id / "vars.json"
        )
        vars_path.write_text("{}", encoding="utf-8")
        args = svc._build_runner_args(
            req=self._minimal_request(),
            job_dir=Path(self._tmp.name) / "workspaces" / self.workspace_id,
            inventory_path=(
                Path(self._tmp.name)
                / "workspaces"
                / self.workspace_id
                / "inventory.yml"
            ),
            inventory_arg="/workspace/inventory.yml",
            roles_from_inventory=[],
        )

        self.assertIn("-e", args)
        self.assertIn("@/workspace/vars.json", args)
        expected_extra_args = shlex.split(os.environ["JOB_RUNNER_ANSIBLE_ARGS"])
        self.assertEqual(args[-len(expected_extra_args) :], expected_extra_args)

    def test_materialize_workspace_group_vars_into_host_vars_merges_overrides(
        self,
    ) -> None:
        from services.job_runner import JobRunnerService  # noqa: WPS433

        workspace_root = Path(self._tmp.name) / "workspaces" / self.workspace_id
        (workspace_root / "inventory.yml").write_text(
            "all:\n"
            "  children:\n"
            "    example-role:\n"
            "      hosts:\n"
            "        device: {}\n"
            "        edge: {}\n",
            encoding="utf-8",
        )
        (workspace_root / "group_vars").mkdir(parents=True, exist_ok=True)
        (workspace_root / "group_vars" / "all.yml").write_text(
            "users:\n"
            "  administrator:\n"
            "    authorized_keys:\n"
            "      - ssh-ed25519 AAAATEST infinito-test\n"
            "applications:\n"
            "  web-app-dashboard:\n"
            "    compose:\n"
            "      services:\n"
            "        oidc:\n"
            "          enabled: false\n"
            "        dashboard:\n"
            "          enabled: true\n",
            encoding="utf-8",
        )
        (workspace_root / "host_vars").mkdir(parents=True, exist_ok=True)
        (workspace_root / "host_vars" / "device.yml").write_text(
            "ansible_host: ssh-password\n"
            "users:\n"
            "  administrator:\n"
            "    email: admin@example.test\n"
            "applications:\n"
            "  web-app-dashboard:\n"
            "    plan_id: dashboard-default\n",
            encoding="utf-8",
        )
        (workspace_root / "host_vars" / "edge.yml").write_text(
            "ansible_host: edge.example.test\n",
            encoding="utf-8",
        )

        svc = JobRunnerService()
        svc._materialize_workspace_group_vars_into_host_vars(workspace_root)

        device_host_vars = yaml.safe_load(
            (workspace_root / "host_vars" / "device.yml").read_text(encoding="utf-8")
        )
        edge_host_vars = yaml.safe_load(
            (workspace_root / "host_vars" / "edge.yml").read_text(encoding="utf-8")
        )

        self.assertEqual(device_host_vars["ansible_host"], "ssh-password")
        self.assertEqual(
            device_host_vars["users"]["administrator"]["email"],
            "admin@example.test",
        )
        self.assertEqual(
            device_host_vars["users"]["administrator"]["authorized_keys"],
            ["ssh-ed25519 AAAATEST infinito-test"],
        )
        self.assertEqual(
            device_host_vars["applications"]["web-app-dashboard"]["plan_id"],
            "dashboard-default",
        )
        self.assertFalse(
            device_host_vars["applications"]["web-app-dashboard"]["compose"][
                "services"
            ]["oidc"]["enabled"]
        )
        self.assertEqual(
            edge_host_vars["users"]["administrator"]["authorized_keys"],
            ["ssh-ed25519 AAAATEST infinito-test"],
        )
        self.assertTrue(
            edge_host_vars["applications"]["web-app-dashboard"]["compose"]["services"][
                "dashboard"
            ]["enabled"]
        )

    def test_build_runner_args_supports_direct_workspace_playbook(self) -> None:
        from services.job_runner import JobRunnerService  # noqa: WPS433

        svc = JobRunnerService()
        args = svc._build_runner_args(
            req=self._playbook_request(),
            job_dir=Path(self._tmp.name) / "workspaces" / self.workspace_id,
            inventory_path=(
                Path(self._tmp.name)
                / "workspaces"
                / self.workspace_id
                / "inventory.yml"
            ),
            inventory_arg="/workspace/inventory.yml",
            roles_from_inventory=[],
        )

        self.assertEqual(
            args[:3],
            ["ansible-playbook", "-i", "/workspace/inventory.yml"],
        )
        self.assertEqual(args[3], "/workspace/playbooks/emit_lines.yml")

    def test_playbook_request_can_omit_selected_roles(self) -> None:
        req = self._playbook_request()
        self.assertEqual(req.selected_roles, [])
        self.assertEqual(req.playbook_path, "playbooks/emit_lines.yml")

    @patch("services.job_runner.service.build_inventory_preview")
    @patch("services.job_runner.service.start_process")
    def test_cancel_marks_job_as_canceled(self, m_start_process, m_preview) -> None:
        m_preview.return_value = (
            "all:\n  hosts:\n    localhost:\n      vars: {}\n",
            [],
        )

        started = {"proc": None, "log_fh": None}

        def _start_process(
            *, run_path, cwd, log_path, secrets=None, on_line=None, args=None
        ):
            # Long enough that cancel has something to kill, short enough to finish fast.
            log_fh = open(log_path, "ab", buffering=0)
            proc = subprocess.Popen(
                ["/bin/bash", "-lc", "sleep 5"],
                cwd=str(cwd),
                stdout=log_fh,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                env=dict(os.environ),
            )
            started["proc"] = proc
            started["log_fh"] = log_fh
            return proc, log_fh, None

        m_start_process.side_effect = _start_process

        from services.job_runner import JobRunnerService  # noqa: WPS433

        svc = JobRunnerService()
        job = svc.create(req=self._minimal_request())

        ok = svc.cancel(job.job_id)
        self.assertTrue(ok)

        # Ensure the subprocess is actually gone BEFORE tempdir cleanup.
        proc = started["proc"]
        if proc is not None:
            try:
                proc.wait(timeout=2)
            except Exception:
                # Best-effort: if it didn't die quickly, still proceed.
                pass

        # Wait until job status reflects cancellation
        for _ in range(200):
            cur = svc.get(job.job_id)
            if cur.status == "canceled":
                break
            time.sleep(0.01)

        cur = svc.get(job.job_id)
        self.assertEqual(cur.status, "canceled")

        # Give background thread time to write final metadata before tempdir cleanup.
        time.sleep(0.05)

    def test_cancel_delegates_managed_jobs_to_runner_manager(self) -> None:
        from services.job_runner import JobRunnerService  # noqa: WPS433

        job_id = "123e4567-e89b-42d3-a456-426614174222"
        job_dir = Path(self._tmp.name) / "jobs" / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        (job_dir / "job.json").write_text(
            json.dumps(
                {
                    "job_id": job_id,
                    "status": "running",
                    "managed_by_runner_manager": True,
                }
            ),
            encoding="utf-8",
        )
        (job_dir / "request.json").write_text(
            json.dumps({"workspace_id": self.workspace_id}),
            encoding="utf-8",
        )

        svc = JobRunnerService()
        runner_manager = SimpleNamespace()
        runner_manager.cancel_job = MagicMock(return_value=SimpleNamespace(ok=True))

        with patch.object(
            svc,
            "_runner_manager_client",
            return_value=runner_manager,
        ) as m_client:
            ok = svc.cancel(job_id)

        self.assertTrue(ok)
        m_client.assert_called_once_with()
        runner_manager.cancel_job.assert_called_once_with(job_id)

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

    @patch("services.job_runner.service.RunnerManagerClient")
    @patch("services.job_runner.service.load_container_config")
    def test_runner_manager_mode_omits_auth_placeholders_from_extra_vars(
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

        svc = JobRunnerService()
        job = svc.create(req=self._secret_request())

        vars_payload = json.loads(
            (Path(job.workspace_dir) / "vars.json").read_text(encoding="utf-8")
        )

        self.assertNotIn("ansible_password", vars_payload)
        self.assertNotIn("ansible_ssh_pass", vars_payload)
        self.assertNotIn("ansible_become_password", vars_payload)

    @patch("services.job_runner.service.threading.Thread")
    @patch("services.job_runner.service.RunnerManagerClient")
    @patch("services.job_runner.service.load_container_config")
    def test_runner_manager_mode_starts_secret_cleanup_watcher(
        self,
        m_load_container_config,
        m_manager_client,
        m_thread,
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

        JobRunnerService().create(req=self._secret_request())

        watcher_calls = [
            call
            for call in m_thread.call_args_list
            if call.kwargs.get("target")
            and getattr(call.kwargs["target"], "__name__", "")
            == "_watch_managed_job_cleanup"
        ]
        self.assertEqual(len(watcher_calls), 1)
        self.assertTrue(watcher_calls[0].kwargs["daemon"])
        m_thread.return_value.start.assert_called()

    def test_get_cleans_up_terminal_managed_job_secret_material(self) -> None:
        from services.job_runner import JobRunnerService  # noqa: WPS433

        svc = JobRunnerService()
        job_id = "managed-terminal-job"
        job_dir = Path(self._tmp.name) / "jobs" / job_id
        secrets_dir = job_dir / "secrets"
        secrets_dir.mkdir(parents=True)
        (secrets_dir / "ssh_password").write_text("topsecret", encoding="utf-8")
        (job_dir / "job.json").write_text(
            json.dumps(
                {
                    "job_id": job_id,
                    "status": "canceled",
                    "managed_by_runner_manager": True,
                }
            ),
            encoding="utf-8",
        )
        (job_dir / "request.json").write_text(
            json.dumps({"workspace_id": self.workspace_id}),
            encoding="utf-8",
        )

        job = svc.get(job_id)

        self.assertEqual(job.status, "canceled")
        self.assertFalse(secrets_dir.exists())

    @patch("services.job_runner.service._release_process_memory")
    @patch("services.job_runner.service.time.sleep", return_value=None)
    def test_watch_managed_job_cleanup_waits_for_terminal_state(
        self,
        _m_sleep,
        m_release_process_memory,
    ) -> None:
        from services.job_runner import JobRunnerService  # noqa: WPS433

        svc = JobRunnerService()
        job_id = "managed-watch-job"
        job_dir = Path(self._tmp.name) / "jobs" / job_id
        secrets_dir = job_dir / "secrets"
        secrets_dir.mkdir(parents=True)
        (secrets_dir / "ssh_password").write_text("topsecret", encoding="utf-8")
        job_json_path = job_dir / "job.json"
        job_json_path.write_text(
            json.dumps(
                {
                    "job_id": job_id,
                    "status": "running",
                    "managed_by_runner_manager": True,
                }
            ),
            encoding="utf-8",
        )

        call_count = {"value": 0}

        def _load_json_with_transition(path):
            path_obj = Path(path)
            payload = json.loads(path_obj.read_text(encoding="utf-8"))
            if path_obj == job_json_path:
                call_count["value"] += 1
                if call_count["value"] == 2:
                    payload["status"] = "succeeded"
                    job_json_path.write_text(json.dumps(payload), encoding="utf-8")
            return payload

        with patch(
            "services.job_runner.service.load_json",
            side_effect=_load_json_with_transition,
        ):
            svc._watch_managed_job_cleanup(job_id)

        self.assertFalse(secrets_dir.exists())
        m_release_process_memory.assert_called_once_with()
