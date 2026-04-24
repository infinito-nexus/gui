from ._job_runner_service_support import *  # noqa: F403


class TestJobRunnerServicePart4(JobRunnerServiceTestCase):
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
