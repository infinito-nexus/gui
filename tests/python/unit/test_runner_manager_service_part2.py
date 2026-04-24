from ._runner_manager_service_support import *  # noqa: F403


class TestRunnerManagerServicePart2(RunnerManagerServiceTestCase):
    @patch("services.runner_manager_service.remove_network")
    @patch.object(RunnerManagerService, "_disconnect_mode_a_targets")
    def test_wait_and_finalize_removes_dedicated_network(
        self,
        m_disconnect_mode_a_targets,
        m_remove_network,
    ) -> None:
        job_id = self.JOB_ID
        job_dir = Path(self._tmp.name) / "jobs" / job_id
        job_dir.mkdir(parents=True)
        (job_dir / "job.json").write_text(
            json.dumps(
                {
                    "job_id": job_id,
                    "status": "running",
                    "network_name": f"job-{job_id}",
                    "mode_a_targets": [
                        {"container_name": "infinito-deployer-ssh-password"}
                    ],
                }
            ),
            encoding="utf-8",
        )

        proc = MagicMock()
        proc.wait.return_value = 0
        log_fh = MagicMock()
        reader = MagicMock()

        service = RunnerManagerService()
        service._wait_and_finalize(job_id, proc, log_fh, reader)

        m_disconnect_mode_a_targets.assert_called_once()
        m_remove_network.assert_called_once_with(f"job-{job_id}")

    @patch("services.runner_manager_service.subprocess.run")
    def test_connect_mode_a_targets_attaches_compose_adjacent_service_by_ansible_host(
        self,
        m_run,
    ) -> None:
        job_id = self.JOB_ID
        job_dir = Path(self._tmp.name) / "jobs" / job_id / "host_vars"
        job_dir.mkdir(parents=True)
        (job_dir / "device.yml").write_text(
            "ansible_host: ssh-password\n",
            encoding="utf-8",
        )
        m_run.return_value.returncode = 0
        m_run.return_value.stdout = ""
        m_run.return_value.stderr = ""

        service = RunnerManagerService()
        with patch.object(
            service,
            "_docker_lines",
            side_effect=lambda *args: (
                ["infinito-deployer-ssh-password"]
                if args
                == (
                    "ps",
                    "--filter",
                    "label=com.docker.compose.service=ssh-password",
                    "--format",
                    "{{.Names}}",
                )
                else []
            ),
        ):
            attachments = service._connect_mode_a_targets(
                MagicMock(job_dir=Path(self._tmp.name) / "jobs" / job_id),
                f"job-{job_id}",
            )

        self.assertEqual(
            attachments,
            [
                {
                    "container_name": "infinito-deployer-ssh-password",
                    "aliases": ["device", "ssh-password"],
                }
            ],
        )
        self.assertEqual(
            m_run.call_args.args[0],
            [
                "docker",
                "network",
                "connect",
                "--alias",
                "device",
                "--alias",
                "ssh-password",
                f"job-{job_id}",
                "infinito-deployer-ssh-password",
            ],
        )

    @patch("services.runner_manager_service.subprocess.run")
    def test_connect_mode_a_targets_reads_ansible_host_when_host_vars_contains_vault_tags(
        self,
        m_run,
    ) -> None:
        job_id = self.JOB_ID
        host_vars_dir = Path(self._tmp.name) / "jobs" / job_id / "host_vars"
        host_vars_dir.mkdir(parents=True)
        (host_vars_dir / "device.yml").write_text(
            (
                "ansible_host: ssh-password\n"
                "applications:\n"
                "  svc-db-mariadb:\n"
                "    credentials:\n"
                "      root_password: !vault |\n"
                "        $ANSIBLE_VAULT;1.1;AES256\n"
                "        deadbeefdeadbeefdeadbeefdeadbeef\n"
            ),
            encoding="utf-8",
        )
        m_run.return_value.returncode = 0
        m_run.return_value.stdout = ""
        m_run.return_value.stderr = ""

        service = RunnerManagerService()
        with patch.object(
            service,
            "_docker_lines",
            side_effect=lambda *args: (
                ["infinito-deployer-ssh-password"]
                if args
                == (
                    "ps",
                    "--filter",
                    "label=com.docker.compose.service=ssh-password",
                    "--format",
                    "{{.Names}}",
                )
                else []
            ),
        ):
            attachments = service._connect_mode_a_targets(
                MagicMock(job_dir=Path(self._tmp.name) / "jobs" / job_id),
                f"job-{job_id}",
            )

        self.assertEqual(
            attachments,
            [
                {
                    "container_name": "infinito-deployer-ssh-password",
                    "aliases": ["device", "ssh-password"],
                }
            ],
        )

    @patch.object(RunnerManagerService, "sweep_orphans")
    @patch("services.runner_manager_service.threading.Thread")
    def test_init_starts_background_orphan_sweep_thread_when_enabled(
        self,
        m_thread,
        m_sweep_orphans,
    ) -> None:
        os.environ["JOB_ORPHAN_SWEEP_INTERVAL_SECONDS"] = "123"
        os.environ["RUNNER_MANAGER_ORPHAN_SWEEP_ENABLED"] = "true"

        RunnerManagerService()

        m_sweep_orphans.assert_called_once_with()
        m_thread.assert_called_once()
        self.assertEqual(
            m_thread.call_args.kwargs["kwargs"],
            {"interval_seconds": 123},
        )
        m_thread.return_value.start.assert_called_once_with()

    @patch.object(RunnerManagerService, "_emit_orphan_sweep_event")
    @patch("services.runner_manager_service.remove_volume")
    @patch("services.runner_manager_service.remove_network")
    @patch("services.runner_manager_service.remove_container")
    @patch("services.runner_manager_service.inspect_container_labels")
    def test_sweep_removes_orphaned_runtime_artifacts(
        self,
        m_inspect_labels,
        m_remove_container,
        m_remove_network,
        m_remove_volume,
        m_emit_event,
    ) -> None:
        active_job_dir = Path(self._tmp.name) / "jobs" / self.JOB_ID
        active_job_dir.mkdir(parents=True)
        (active_job_dir / "job.json").write_text(
            json.dumps(
                {
                    "job_id": self.JOB_ID,
                    "status": "running",
                    "network_name": f"job-{self.JOB_ID}",
                }
            ),
            encoding="utf-8",
        )
        (active_job_dir / "request.json").write_text(
            json.dumps({"workspace_id": "workspace-123"}),
            encoding="utf-8",
        )

        service = RunnerManagerService()
        os.environ["RUNNER_MANAGER_ORPHAN_SWEEP_ENABLED"] = "true"
        with (
            patch.object(
                service,
                "_list_runner_container_names",
                return_value=["infinito-job-active", "infinito-job-orphan"],
            ),
            patch.object(
                service,
                "_list_job_network_names",
                return_value=[f"job-{self.JOB_ID}", f"job-{self.OTHER_JOB_ID}"],
            ),
            patch.object(
                service,
                "_list_ssh_egress_sidecars",
                return_value=[
                    f"ssh-egress-{self.JOB_ID}",
                    f"ssh-egress-{self.OTHER_JOB_ID}",
                ],
            ),
            patch.object(
                service,
                "_list_secret_volume_names",
                return_value=[
                    f"infinito-job-secrets-{self.JOB_ID}",
                    f"infinito-job-secrets-{self.OTHER_JOB_ID}",
                ],
            ),
        ):
            m_inspect_labels.side_effect = [
                {
                    "infinito.deployer.job_id": self.JOB_ID,
                    "infinito.deployer.workspace_id": "workspace-123",
                },
                {
                    "infinito.deployer.job_id": self.OTHER_JOB_ID,
                    "infinito.deployer.workspace_id": "workspace-other",
                },
            ]

            service.sweep_orphans()

        m_remove_container.assert_any_call("infinito-job-orphan")
        m_remove_container.assert_any_call(f"ssh-egress-{self.OTHER_JOB_ID}")
        m_remove_network.assert_called_once_with(f"job-{self.OTHER_JOB_ID}")
        m_remove_volume.assert_called_once_with(
            f"infinito-job-secrets-{self.OTHER_JOB_ID}"
        )
        self.assertEqual(m_emit_event.call_count, 4)
