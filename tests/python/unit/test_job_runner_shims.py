import csv
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
    def test_controller_baudolo_seed_shim_updates_semicolon_csv(self, m_preview) -> None:
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


if __name__ == "__main__":
    unittest.main()
