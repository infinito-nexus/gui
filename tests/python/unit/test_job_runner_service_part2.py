from ._job_runner_service_support import *  # noqa: F403


class TestJobRunnerServicePart2(JobRunnerServiceTestCase):
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
