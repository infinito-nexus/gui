from ._runner_manager_service_support import *  # noqa: F403


class TestRunnerManagerServicePart3(RunnerManagerServiceTestCase):
    @patch.object(RunnerManagerService, "_emit_orphan_sweep_event")
    def test_sweep_removes_stale_terminal_job_dirs(
        self,
        m_emit_event,
    ) -> None:
        stale_job_dir = Path(self._tmp.name) / "jobs" / self.OTHER_JOB_ID
        stale_job_dir.mkdir(parents=True)
        finished_at = (
            (datetime.now(timezone.utc) - timedelta(days=8))
            .isoformat()
            .replace("+00:00", "Z")
        )
        (stale_job_dir / "job.json").write_text(
            json.dumps(
                {
                    "job_id": self.OTHER_JOB_ID,
                    "status": "succeeded",
                    "finished_at": finished_at,
                }
            ),
            encoding="utf-8",
        )
        (stale_job_dir / "request.json").write_text(
            json.dumps({"workspace_id": "workspace-old"}),
            encoding="utf-8",
        )

        service = RunnerManagerService()
        os.environ["RUNNER_MANAGER_ORPHAN_SWEEP_ENABLED"] = "true"
        with (
            patch.object(service, "_list_runner_container_names", return_value=[]),
            patch.object(service, "_list_job_network_names", return_value=[]),
            patch.object(service, "_list_ssh_egress_sidecars", return_value=[]),
        ):
            service.sweep_orphans()

        self.assertFalse(stale_job_dir.exists())
        m_emit_event.assert_called_once_with(
            artifact_type="job-dir",
            artifact_id=self.OTHER_JOB_ID,
            workspace_id="workspace-old",
        )
