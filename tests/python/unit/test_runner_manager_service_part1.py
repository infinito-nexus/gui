from ._runner_manager_service_support import *  # noqa: F403


class TestRunnerManagerServicePart1(RunnerManagerServiceTestCase):
    @patch("services.runner_manager_service.start_process")
    @patch("services.runner_manager_service.build_container_command")
    @patch.object(RunnerManagerService, "_bootstrap_runner_secrets")
    @patch.object(RunnerManagerService, "_wait_for_container_running")
    @patch.object(RunnerManagerService, "_connect_mode_a_targets")
    @patch("services.runner_manager_service.create_tmpfs_volume")
    @patch("services.runner_manager_service.create_internal_network")
    @patch("services.runner_manager_service.load_container_config")
    @patch("services.runner_manager_service.threading.Thread")
    def test_create_does_not_read_secret_file_contents(
        self,
        m_thread,
        m_load_container_config,
        m_create_network,
        m_create_tmpfs_volume,
        m_connect_mode_a_targets,
        m_wait_for_container_running,
        m_bootstrap_runner_secrets,
        m_build_container_command,
        m_start_process,
    ) -> None:
        job_id = self.JOB_ID
        job_dir = Path(self._tmp.name) / "jobs" / job_id
        secrets_dir = job_dir / "secrets"
        secrets_dir.mkdir(parents=True)
        (secrets_dir / "ssh_password").write_text("topsecret", encoding="utf-8")
        (job_dir / "runner-control.json").write_text(
            json.dumps({"cli_args": ["infinito", "deploy", "dedicated"]}),
            encoding="utf-8",
        )
        (job_dir / "job.json").write_text(
            json.dumps({"job_id": job_id, "status": "queued"}),
            encoding="utf-8",
        )

        m_load_container_config.return_value = ContainerRunnerConfig(
            image=self.RUNNER_IMAGE,
            repo_dir="/opt/src/infinito",
            workdir="/workspace",
            network="bridge",
            extra_args=[],
            skip_cleanup=False,
            skip_build=False,
        )
        m_build_container_command.return_value = (
            ["docker", "run", "--rm"],
            "container-123",
            m_load_container_config.return_value,
        )
        m_connect_mode_a_targets.return_value = [
            {
                "container_name": "infinito-deployer-ssh-password",
                "aliases": ["device", "ssh-password"],
            }
        ]
        proc = MagicMock()
        proc.pid = 1234
        log_fh = MagicMock()
        reader = MagicMock()
        m_start_process.return_value = (proc, log_fh, reader)
        m_thread.return_value.start.return_value = None

        service = RunnerManagerService()
        with patch.object(
            service,
            "_collect_secret_values",
            side_effect=AssertionError("runner-manager must not read secret files"),
        ) as m_collect:
            job = service.create(self._spec(job_id))

        self.assertEqual(job.job_id, job_id)
        self.assertEqual(job.status, "running")
        m_create_network.assert_called_once_with(f"job-{job_id}")
        m_connect_mode_a_targets.assert_called_once()
        self.assertEqual(m_start_process.call_args.kwargs["secrets"], [])
        self.assertEqual(
            m_build_container_command.call_args.kwargs["runtime_env"],
            {
                "INFINITO_SECRETS_DIR": "/run/secrets/infinito",
                "INFINITO_WAIT_FOR_SECRETS_READY": "1",
                "INFINITO_SECRETS_READY_FILE": "/run/secrets/infinito/.ready",
            },
        )
        m_create_tmpfs_volume.assert_called_once_with(
            "infinito-job-secrets-123e4567-e89b-42d3-a456-426614174000"
        )
        self.assertEqual(m_build_container_command.call_args.kwargs["bind_mounts"], [])
        self.assertEqual(
            m_build_container_command.call_args.kwargs["volume_mounts"],
            [
                (
                    "infinito-job-secrets-123e4567-e89b-42d3-a456-426614174000",
                    "/run/secrets/infinito",
                    True,
                )
            ],
        )
        forwarded_cfg = m_build_container_command.call_args.kwargs["cfg"]
        self.assertIn("--group-add", forwarded_cfg.extra_args)
        self.assertIn(str(job_dir.stat().st_gid), forwarded_cfg.extra_args)
        m_wait_for_container_running.assert_called_once_with("container-123")
        m_bootstrap_runner_secrets.assert_called_once_with(
            secret_volume_name="infinito-job-secrets-123e4567-e89b-42d3-a456-426614174000",
            source_dir=self._spec(job_id).secrets_dir,
            image=self.RUNNER_IMAGE,
        )
        written_meta = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
        self.assertEqual(
            written_meta["mode_a_targets"],
            [
                {
                    "container_name": "infinito-deployer-ssh-password",
                    "aliases": ["device", "ssh-password"],
                }
            ],
        )
        self.assertEqual(
            m_build_container_command.call_args.kwargs["tmpfs_mounts"],
            [
                "/tmp:rw,noexec,nosuid,nodev,size=64m",
                "/run/infinito-repo:rw,exec,nosuid,nodev,size=256m,uid=10002,gid=10002,mode=0700",
                "/run/inventory:rw,noexec,nosuid,nodev,size=8m,uid=10002,gid=10002,mode=0700",
                "/run/sudo:rw,exec,nosuid,nodev,size=8m,uid=10002,gid=10002,mode=0700",
            ],
        )
        m_collect.assert_not_called()

    @patch("services.runner_manager_service.subprocess.run")
    @patch("services.runner_manager_service.resolve_host_mount_source")
    @patch("services.runner_manager_service.resolve_docker_bin")
    def test_bootstrap_runner_secrets_uses_shared_tmpfs_volume(
        self,
        m_resolve_docker_bin,
        m_resolve_host_mount_source,
        m_run,
    ) -> None:
        m_resolve_docker_bin.return_value = "docker"
        m_resolve_host_mount_source.return_value = "/host/jobs/job-1/secrets"
        m_run.return_value.returncode = 0
        m_run.return_value.stdout = ""
        m_run.return_value.stderr = ""

        service = RunnerManagerService()
        service._bootstrap_runner_secrets(
            secret_volume_name="infinito-job-secrets-job-1",
            source_dir="/state/jobs/job-1/secrets",
            image=self.RUNNER_IMAGE,
        )

        cmd = m_run.call_args.args[0]
        self.assertEqual(
            cmd[:10],
            [
                "docker",
                "run",
                "--rm",
                "-v",
                "infinito-job-secrets-job-1:/run/secrets/infinito",
                "-v",
                "/host/jobs/job-1/secrets:/infinito-source-secrets:ro",
                "--entrypoint",
                "/bin/sh",
                self.RUNNER_IMAGE,
            ],
        )
        self.assertEqual(cmd[10], "-lc")
        self.assertIn('cp "${src}" "${dst}"', cmd[11])
        self.assertIn('chown 10002:10002 "${dst}"', cmd[11])
        self.assertIn('chmod 0400 "${dst}"', cmd[11])
        self.assertIn(': > "/run/secrets/infinito/.ready"', cmd[11])

    @patch("services.runner_manager_service.inspect_container_labels")
    def test_get_rejects_mismatched_live_workspace_label(
        self,
        m_inspect_labels,
    ) -> None:
        job_id = self.JOB_ID
        job_dir = Path(self._tmp.name) / "jobs" / job_id
        job_dir.mkdir(parents=True)
        (job_dir / "job.json").write_text(
            json.dumps(
                {
                    "job_id": job_id,
                    "status": "running",
                    "container_id": "container-123",
                }
            ),
            encoding="utf-8",
        )
        (job_dir / "request.json").write_text(
            json.dumps({"workspace_id": "workspace-123"}),
            encoding="utf-8",
        )
        m_inspect_labels.return_value = {
            "infinito.deployer.workspace_id": "workspace-other"
        }

        service = RunnerManagerService()

        with self.assertRaises(HTTPException) as ctx:
            service.get(job_id, workspace_id="workspace-123")
        self.assertEqual(ctx.exception.status_code, 404)

    @patch("services.runner_manager_service.inspect_container_labels")
    def test_list_jobs_skips_running_jobs_with_mismatched_live_workspace_label(
        self,
        m_inspect_labels,
    ) -> None:
        job_id = self.JOB_ID
        job_dir = Path(self._tmp.name) / "jobs" / job_id
        job_dir.mkdir(parents=True)
        (job_dir / "job.json").write_text(
            json.dumps(
                {
                    "job_id": job_id,
                    "status": "running",
                    "container_id": "container-123",
                }
            ),
            encoding="utf-8",
        )
        (job_dir / "request.json").write_text(
            json.dumps({"workspace_id": "workspace-123"}),
            encoding="utf-8",
        )
        m_inspect_labels.return_value = {
            "infinito.deployer.workspace_id": "workspace-other"
        }

        service = RunnerManagerService()
        jobs = service.list_jobs(workspace_id="workspace-123", status="running")

        self.assertEqual(jobs, [])

    @patch("services.runner_manager_service.remove_network")
    @patch("services.runner_manager_service.stop_container")
    @patch("services.runner_manager_service.terminate_process_group")
    @patch.object(RunnerManagerService, "_disconnect_mode_a_targets")
    def test_cancel_removes_dedicated_network(
        self,
        m_disconnect_mode_a_targets,
        m_terminate,
        m_stop_container,
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
                    "pid": 1234,
                    "container_id": "container-123",
                    "network_name": f"job-{job_id}",
                    "mode_a_targets": [
                        {"container_name": "infinito-deployer-ssh-password"}
                    ],
                }
            ),
            encoding="utf-8",
        )
        (job_dir / "request.json").write_text(
            json.dumps({"workspace_id": "workspace-123"}),
            encoding="utf-8",
        )

        service = RunnerManagerService()
        ok = service.cancel(job_id, workspace_id="workspace-123")

        self.assertTrue(ok)
        m_terminate.assert_called_once_with(1234)
        m_stop_container.assert_called_once_with("container-123")
        m_disconnect_mode_a_targets.assert_called_once()
        m_remove_network.assert_called_once_with(f"job-{job_id}")
