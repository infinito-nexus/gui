import os
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from api.schemas.runner_manager import RunnerManagerJobSpec
from services.runner_manager_client import RunnerManagerClient


class TestRunnerManagerClient(unittest.TestCase):
    JOB_ID = "123e4567-e89b-42d3-a456-426614174000"
    RUNNER_IMAGE = "ghcr.io/example/runner@sha256:" + ("a" * 64)

    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._old_env = {
            "RUNNER_MANAGER_URL": os.environ.get("RUNNER_MANAGER_URL"),
            "MANAGER_TOKEN_FILE": os.environ.get("MANAGER_TOKEN_FILE"),
        }
        os.environ["RUNNER_MANAGER_URL"] = "http://runner-manager:8001"
        os.environ["MANAGER_TOKEN_FILE"] = os.path.join(self._tmp.name, "token")
        with open(os.environ["MANAGER_TOKEN_FILE"], "w", encoding="utf-8") as handle:
            handle.write("shared-token")

    def tearDown(self) -> None:
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def _spec(self) -> RunnerManagerJobSpec:
        return RunnerManagerJobSpec(
            job_id=self.JOB_ID,
            workspace_id="workspace-123",
            runner_image=self.RUNNER_IMAGE,
            inventory_path="inventory.yml",
            secrets_dir=os.path.join(self._tmp.name, "secrets"),
            role_ids=["web-app-dashboard"],
            network_name=f"job-{self.JOB_ID}",
            labels={
                "infinito.deployer.job_id": self.JOB_ID,
                "infinito.deployer.workspace_id": "workspace-123",
                "infinito.deployer.role": "job-runner",
            },
        )

    @patch("services.runner_manager_client.httpx.Client")
    def test_start_job_reads_token_from_file_for_each_request(self, m_client) -> None:
        response = MagicMock()
        response.status_code = 200
        response.json.return_value = {
            "job_id": self.JOB_ID,
            "status": "running",
            "created_at": "2026-04-22T20:00:00Z",
            "started_at": "2026-04-22T20:00:01Z",
            "finished_at": None,
            "pid": 1234,
            "exit_code": None,
            "container_id": "container-1",
            "workspace_dir": f"/state/jobs/{self.JOB_ID}",
            "log_path": f"/state/jobs/{self.JOB_ID}/job.log",
            "inventory_path": f"/state/jobs/{self.JOB_ID}/inventory.yml",
            "request_path": f"/state/jobs/{self.JOB_ID}/request.json",
        }
        client_ctx = m_client.return_value.__enter__.return_value
        client_ctx.request.return_value = response

        client = RunnerManagerClient()
        job = client.start_job(self._spec())

        headers = client_ctx.request.call_args.kwargs["headers"]
        self.assertEqual(headers["x-manager-token"], "shared-token")
        self.assertEqual(job.job_id, self.JOB_ID)

    def test_start_job_requires_token_file(self) -> None:
        os.remove(os.environ["MANAGER_TOKEN_FILE"])
        client = RunnerManagerClient()
        with self.assertRaises(HTTPException) as ctx:
            client.start_job(self._spec())
        self.assertEqual(ctx.exception.status_code, 500)

    @patch("services.runner_manager_client.httpx.Client")
    def test_workspace_scoped_requests_forward_workspace_query_params(
        self,
        m_client,
    ) -> None:
        response = MagicMock()
        response.status_code = 200
        response.json.side_effect = [
            {
                "job_id": self.JOB_ID,
                "status": "running",
                "created_at": "2026-04-22T20:00:00Z",
                "started_at": None,
                "finished_at": None,
                "pid": None,
                "exit_code": None,
                "container_id": None,
                "workspace_dir": f"/state/jobs/{self.JOB_ID}",
                "log_path": f"/state/jobs/{self.JOB_ID}/job.log",
                "inventory_path": f"/state/jobs/{self.JOB_ID}/inventory.yml",
                "request_path": f"/state/jobs/{self.JOB_ID}/request.json",
            },
            {"ok": True},
            [],
        ]
        client_ctx = m_client.return_value.__enter__.return_value
        client_ctx.request.return_value = response

        client = RunnerManagerClient()
        client.get_job(self.JOB_ID, workspace_id="workspace-123")
        client.cancel_job(self.JOB_ID, workspace_id="workspace-123")
        client.list_jobs(workspace_id="workspace-123", status="running")

        get_call, delete_call, list_call = client_ctx.request.call_args_list
        self.assertEqual(get_call.kwargs["params"], {"workspace_id": "workspace-123"})
        self.assertEqual(
            delete_call.kwargs["params"],
            {"workspace_id": "workspace-123"},
        )
        self.assertEqual(
            list_call.kwargs["params"],
            {"workspace_id": "workspace-123", "status": "running"},
        )
