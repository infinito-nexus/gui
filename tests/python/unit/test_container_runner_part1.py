from ._container_runner_support import *  # noqa: F403


class TestContainerRunnerPart1(ContainerRunnerTestCase):
    @patch("services.job_runner.container_runner.subprocess.run")
    def test_create_internal_network_uses_internal_bridge(self, m_run) -> None:
        m_run.return_value.returncode = 0
        m_run.return_value.stderr = ""

        create_internal_network("job-123e4567-e89b-42d3-a456-426614174000")

        self.assertEqual(
            m_run.call_args.args[0],
            [
                "docker",
                "network",
                "create",
                "--driver",
                "bridge",
                "--internal",
                "job-123e4567-e89b-42d3-a456-426614174000",
            ],
        )

    @patch("services.job_runner.container_runner.subprocess.run")
    def test_remove_network_is_best_effort(self, m_run) -> None:
        remove_network("job-123e4567-e89b-42d3-a456-426614174000")

        self.assertEqual(
            m_run.call_args.args[0],
            [
                "docker",
                "network",
                "rm",
                "job-123e4567-e89b-42d3-a456-426614174000",
            ],
        )

    @patch("services.job_runner.container_runner.subprocess.run")
    def test_stop_container_uses_graceful_timeout_before_force_kill(
        self,
        m_run,
    ) -> None:
        stop_container("runner-123")

        self.assertEqual(
            m_run.call_args.args[0],
            ["docker", "stop", "--time", "10", "runner-123"],
        )

    @patch("services.job_runner.container_runner.subprocess.run")
    def test_inspect_container_labels_reads_docker_inspect_json(self, m_run) -> None:
        m_run.return_value.returncode = 0
        m_run.return_value.stdout = '{"infinito.deployer.workspace_id":"workspace-123"}'

        labels = inspect_container_labels("runner-123")

        self.assertEqual(
            labels,
            {"infinito.deployer.workspace_id": "workspace-123"},
        )

    def test_load_container_config_reads_image_and_repo_dir(self) -> None:
        old_env = {
            "JOB_RUNNER_IMAGE": os.environ.get("JOB_RUNNER_IMAGE"),
        }
        os.environ["JOB_RUNNER_IMAGE"] = "infinito-arch"

        try:
            cfg = load_container_config()
        finally:
            for key, value in old_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

        self.assertEqual(cfg.image, "infinito-arch")
        self.assertEqual(cfg.repo_dir, "/opt/src/infinito")

    def test_build_container_command_sets_python_unbuffered(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            state_dir = tmp_path / "state" / "jobs"
            job_dir = state_dir / "abc123"
            job_dir.mkdir(parents=True, exist_ok=True)

            old_state_dir = os.environ.get("STATE_DIR")
            old_state_host_path = os.environ.get("STATE_HOST_PATH")
            os.environ["STATE_DIR"] = str(state_dir)
            os.environ["STATE_HOST_PATH"] = str(state_dir)

            cfg = _make_cfg()

            try:
                with patch(
                    "services.job_runner.container_runner.resolve_docker_bin",
                    return_value="docker",
                ):
                    cmd, _, _ = build_container_command(
                        job_id="abc123",
                        job_dir=job_dir,
                        cli_args=["infinito", "deploy", "dedicated"],
                        cfg=cfg,
                    )
            finally:
                if old_state_dir is None:
                    os.environ.pop("STATE_DIR", None)
                else:
                    os.environ["STATE_DIR"] = old_state_dir
                if old_state_host_path is None:
                    os.environ.pop("STATE_HOST_PATH", None)
                else:
                    os.environ["STATE_HOST_PATH"] = old_state_host_path

            self.assertIn("PYTHONUNBUFFERED=1", cmd)
