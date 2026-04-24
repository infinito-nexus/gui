import csv
import json
import os
import subprocess
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


class TestJobRunnerShims(unittest.TestCase):
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

        return DeploymentRequest(
            workspace_id=self.workspace_id,
            host="localhost",
            user="tester",
            auth={"method": "password", "password": "x"},
            selected_roles=["example-role"],
        )

    def _wait_for_terminal(self, svc, job_id: str) -> None:
        for _ in range(200):
            cur = svc.get(job_id)
            if cur.status in {"succeeded", "failed", "canceled"}:
                return
            time.sleep(0.01)
        time.sleep(0.05)

    @patch("services.job_runner.service.build_inventory_preview")
    def test_controller_baudolo_seed_shim_updates_semicolon_csv(
        self, m_preview
    ) -> None:
        m_preview.return_value = (
            "all:\n  hosts:\n    localhost:\n      vars: {}\n",
            [],
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433

        svc = JobRunnerService()
        job = svc.create(req=self._minimal_request())
        self._wait_for_terminal(svc, job.job_id)

        shim_path = Path(job.workspace_dir) / "baudolo-seed"
        csv_path = Path(job.workspace_dir) / "databases.csv"

        subprocess.run(
            [str(shim_path), str(csv_path), "docker.test", "appdb", "alice", "secret"],
            check=True,
        )
        subprocess.run(
            [str(shim_path), str(csv_path), "docker.test", "appdb", "bob", "newpass"],
            check=True,
        )

        with csv_path.open("r", encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle, delimiter=";"))

        self.assertEqual(
            rows,
            [
                {
                    "instance": "docker.test",
                    "database": "appdb",
                    "username": "bob",
                    "password": "newpass",
                }
            ],
        )

    @patch("services.job_runner.service.build_inventory_preview")
    def test_infinito_shim_prefers_mounted_repo_root(self, m_preview) -> None:
        m_preview.return_value = (
            "all:\n  hosts:\n    localhost:\n      vars: {}\n",
            [],
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433

        svc = JobRunnerService()
        job = svc.create(req=self._minimal_request())
        self._wait_for_terminal(svc, job.job_id)

        shim_path = Path(job.workspace_dir) / "infinito"
        shim = shim_path.read_text(encoding="utf-8")

        self.assertIn('repo_root="${JOB_RUNNER_REPO_DIR:-${PYTHONPATH%%:*}}"', shim)
        self.assertIn('cd "${repo_root}"', shim)
        self.assertEqual(shim_path.stat().st_mode & 0o777, 0o750)

        sudo_shim_path = Path(job.workspace_dir) / "sudo"
        sudo_shim = sudo_shim_path.read_text(encoding="utf-8")
        self.assertIn("no-new-privileges", sudo_shim)
        self.assertIn('exec "$@"', sudo_shim)
        self.assertEqual(sudo_shim_path.stat().st_mode & 0o777, 0o750)

        ssh_keyscan_shim_path = Path(job.workspace_dir) / "ssh-keyscan"
        ssh_keyscan_shim = ssh_keyscan_shim_path.read_text(encoding="utf-8")
        self.assertIn("INFINITO_REAL_SSH_KEYSCAN", ssh_keyscan_shim)
        self.assertIn("github.com ssh-ed25519", ssh_keyscan_shim)
        self.assertEqual(ssh_keyscan_shim_path.stat().st_mode & 0o777, 0o755)

    def test_sshpass_shim_reads_password_from_fd_and_exports_askpass(self) -> None:
        from services.job_runner.shims import write_controller_shims  # noqa: WPS433

        workspace_root = Path(self._tmp.name) / "shim-workspace"
        workspace_root.mkdir(parents=True, exist_ok=True)
        write_controller_shims(workspace_root)

        controller_bin = workspace_root / "controller-bin"
        sshpass = controller_bin / "sshpass"
        capture = workspace_root / "capture.py"
        output = workspace_root / "output.json"
        capture.write_text(
            (
                "#!/usr/bin/env python3\n"
                "import json\n"
                "import os\n"
                "import subprocess\n"
                "import sys\n"
                "from pathlib import Path\n"
                'askpass = os.environ.get("SSH_ASKPASS", "")\n'
                "password = subprocess.run([askpass], check=True, capture_output=True, text=True).stdout\n"
                "Path(sys.argv[1]).write_text(\n"
                "    json.dumps(\n"
                "        {\n"
                '            "password": password,\n'
                '            "askpass_exists": Path(askpass).is_file(),\n'
                '            "askpass_parent": str(Path(askpass).parent),\n'
                '            "askpass_require": os.environ.get("SSH_ASKPASS_REQUIRE"),\n'
                '            "display": os.environ.get("DISPLAY"),\n'
                '            "stdin_isatty": os.isatty(0),\n'
                "        }\n"
                "    ),\n"
                '    encoding="utf-8",\n'
                ")\n"
            ),
            encoding="utf-8",
        )
        capture.chmod(0o755)

        read_fd, write_fd = os.pipe()
        try:
            os.write(write_fd, b"deploy-secret\n")
        finally:
            os.close(write_fd)

        try:
            env = os.environ.copy()
            env.pop("DISPLAY", None)
            askpass_root = workspace_root / "askpass-tmp"
            askpass_root.mkdir(parents=True, exist_ok=True)
            env["INFINITO_SSHPASS_TMPDIR"] = str(askpass_root)
            subprocess.run(
                [str(sshpass), "-d", str(read_fd), str(capture), str(output)],
                check=True,
                pass_fds=(read_fd,),
                env=env,
            )
        finally:
            os.close(read_fd)

        payload = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(payload["password"], "deploy-secret")
        self.assertTrue(payload["askpass_exists"])
        self.assertTrue(
            payload["askpass_parent"].startswith(str(askpass_root)),
            payload["askpass_parent"],
        )
        self.assertEqual(payload["askpass_require"], "force")
        self.assertEqual(payload["display"], "infinito-sshpass:0")
        self.assertFalse(payload["stdin_isatty"])

    def test_runtime_ssh_keyscan_shim_returns_static_github_key(self) -> None:
        from services.job_runner.shims import (  # noqa: WPS433
            write_runtime_command_shims,
        )

        workspace_root = Path(self._tmp.name) / "shim-workspace"
        workspace_root.mkdir(parents=True, exist_ok=True)
        write_runtime_command_shims(workspace_root)

        ssh_keyscan = workspace_root / "ssh-keyscan"
        calls = workspace_root / "real-ssh-keyscan.calls"
        fake_real = workspace_root / "ssh-keyscan.real"
        fake_real.write_text(
            (
                "#!/usr/bin/env bash\n"
                "set -euo pipefail\n"
                f"printf '%s\\n' \"$*\" >>{calls}\n"
                "printf 'unexpected real ssh-keyscan invocation\\n' >&2\n"
                "exit 19\n"
            ),
            encoding="utf-8",
        )
        fake_real.chmod(0o755)

        proc = subprocess.run(
            [str(ssh_keyscan), "-t", "ed25519", "github.com"],
            env={**os.environ, "INFINITO_REAL_SSH_KEYSCAN": str(fake_real)},
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(
            proc.stdout.strip(),
            "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII3+7UnC83CxweO0Gr8ptLLxSgSQ4W0NoJhlCz5ZzVwN",
        )
        self.assertFalse(calls.exists())

    def test_runtime_ssh_keyscan_shim_delegates_unknown_hosts(self) -> None:
        from services.job_runner.shims import (  # noqa: WPS433
            write_runtime_command_shims,
        )

        workspace_root = Path(self._tmp.name) / "shim-workspace"
        workspace_root.mkdir(parents=True, exist_ok=True)
        write_runtime_command_shims(workspace_root)

        ssh_keyscan = workspace_root / "ssh-keyscan"
        calls = workspace_root / "real-ssh-keyscan.calls"
        fake_real = workspace_root / "ssh-keyscan.real"
        fake_real.write_text(
            (
                "#!/usr/bin/env bash\n"
                "set -euo pipefail\n"
                f"printf '%s\\n' \"$*\" >{calls}\n"
                "printf 'internal.example ssh-ed25519 TESTKEY\\n'\n"
            ),
            encoding="utf-8",
        )
        fake_real.chmod(0o755)

        proc = subprocess.run(
            [str(ssh_keyscan), "-t", "ed25519", "internal.example"],
            env={**os.environ, "INFINITO_REAL_SSH_KEYSCAN": str(fake_real)},
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(proc.stdout.strip(), "internal.example ssh-ed25519 TESTKEY")
        self.assertEqual(
            calls.read_text(encoding="utf-8").strip(),
            "-t ed25519 internal.example",
        )

    @patch("services.job_runner.service.build_inventory_preview")
    def test_controller_command_shims_exist_for_lookup_only_binaries(
        self, m_preview
    ) -> None:
        m_preview.return_value = (
            "all:\n  hosts:\n    localhost:\n      vars: {}\n",
            [],
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433

        svc = JobRunnerService()
        job = svc.create(req=self._minimal_request())
        self._wait_for_terminal(svc, job.job_id)

        controller_bin = Path(job.workspace_dir) / "controller-bin"
        expected_commands = {
            "baudolo",
            "cleanback",
            "dockreap",
            "gitcon",
            "ldapsm",
            "setup-hibernate",
            "sshpass",
        }
        self.assertEqual(
            {path.name for path in controller_bin.iterdir()},
            expected_commands,
        )
        for command in expected_commands:
            shim_path = controller_bin / command
            self.assertTrue(shim_path.is_file())
            self.assertTrue(os.access(shim_path, os.X_OK))
            shim_text = shim_path.read_text(encoding="utf-8")
            if command == "sshpass":
                self.assertIn("SSH_ASKPASS_REQUIRE", shim_text)
            else:
                self.assertIn("command_path lookup", shim_text)


if __name__ == "__main__":
    unittest.main()
