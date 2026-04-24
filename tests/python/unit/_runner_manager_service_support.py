import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch
from fastapi import HTTPException
from api.schemas.runner_manager import RunnerManagerJobSpec
from services.job_runner.container_runner import ContainerRunnerConfig
from services.runner_manager_service import RunnerManagerService

if __name__ == "__main__":
    unittest.main()

__all__ = [
    "json",
    "os",
    "unittest",
    "datetime",
    "timedelta",
    "timezone",
    "Path",
    "TemporaryDirectory",
    "MagicMock",
    "patch",
    "HTTPException",
    "RunnerManagerJobSpec",
    "ContainerRunnerConfig",
    "RunnerManagerService",
    "RunnerManagerServiceTestCase",
]


class RunnerManagerServiceTestCase(unittest.TestCase):
    JOB_ID = "123e4567-e89b-42d3-a456-426614174000"

    OTHER_JOB_ID = "123e4567-e89b-42d3-a456-426614174111"

    RUNNER_IMAGE = "ghcr.io/example/runner@sha256:" + ("a" * 64)

    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._old_env = {
            "JOB_ORPHAN_SWEEP_INTERVAL_SECONDS": os.environ.get(
                "JOB_ORPHAN_SWEEP_INTERVAL_SECONDS"
            ),
            "RUNNER_MANAGER_ORPHAN_SWEEP_ENABLED": os.environ.get(
                "RUNNER_MANAGER_ORPHAN_SWEEP_ENABLED"
            ),
            "STATE_DIR": os.environ.get("STATE_DIR"),
            "STATE_HOST_PATH": os.environ.get("STATE_HOST_PATH"),
        }
        os.environ["JOB_ORPHAN_SWEEP_INTERVAL_SECONDS"] = "0"
        os.environ["RUNNER_MANAGER_ORPHAN_SWEEP_ENABLED"] = "false"
        os.environ["STATE_DIR"] = self._tmp.name
        os.environ["STATE_HOST_PATH"] = self._tmp.name

    def tearDown(self) -> None:
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def _spec(self, job_id: str) -> RunnerManagerJobSpec:
        return RunnerManagerJobSpec(
            job_id=job_id,
            workspace_id="workspace-123",
            runner_image=self.RUNNER_IMAGE,
            inventory_path="inventory.yml",
            secrets_dir=str(Path(self._tmp.name) / "jobs" / job_id / "secrets"),
            role_ids=["web-app-dashboard"],
            network_name=f"job-{job_id}",
            labels={
                "infinito.deployer.job_id": job_id,
                "infinito.deployer.workspace_id": "workspace-123",
                "infinito.deployer.role": "job-runner",
            },
        )
