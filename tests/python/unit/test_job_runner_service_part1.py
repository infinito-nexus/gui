from ._job_runner_service_support import *  # noqa: F403


class TestJobRunnerServicePart1(JobRunnerServiceTestCase):
    @patch("services.job_runner.service.build_inventory_preview")
    def test_create_job_creates_files_and_finishes(self, m_preview) -> None:
        m_preview.return_value = (
            "all:\n  hosts:\n    localhost:\n      vars: {}\n",
            [],
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433

        svc = JobRunnerService()
        job = svc.create(req=self._minimal_request())

        self._wait_for_terminal(svc, job.job_id)

        cur = svc.get(job.job_id)
        self.assertIn(cur.status, {"succeeded", "failed"})
        self.assertTrue(os.path.isfile(cur.log_path))
        self.assertTrue(os.path.isfile(cur.inventory_path))
        self.assertTrue(os.path.isfile(cur.request_path))
        self.assertTrue(os.path.isfile(os.path.join(cur.workspace_dir, "vars.json")))
        self.assertTrue(os.path.isfile(os.path.join(cur.workspace_dir, "vars.yml")))
        self.assertTrue(os.path.isfile(os.path.join(cur.workspace_dir, "baudolo-seed")))
        self.assertTrue(
            os.path.isfile(os.path.join(cur.workspace_dir, "runner-passwd"))
        )
        self.assertTrue(os.path.isfile(os.path.join(cur.workspace_dir, "runner-group")))
        self.assertTrue(
            os.path.isfile(os.path.join(cur.workspace_dir, "runner-sudoers"))
        )
        runner_passwd = Path(cur.workspace_dir) / "runner-passwd"
        self.assertIn("/tmp/infinito-home", runner_passwd.read_text(encoding="utf-8"))
        runner_sudoers = Path(cur.workspace_dir) / "runner-sudoers"
        self.assertIn("NOPASSWD:ALL", runner_sudoers.read_text(encoding="utf-8"))

        # Give background thread a tiny window to flush metadata safely
        time.sleep(0.05)

    @patch("services.job_runner.service.build_inventory_preview")
    def test_private_key_writes_key_file(self, m_preview) -> None:
        m_preview.return_value = (
            "all:\n  hosts:\n    localhost:\n      vars: {}\n",
            [],
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433

        old_runner_cmd = os.environ.get("RUNNER_CMD")
        os.environ["RUNNER_CMD"] = "sleep 0.2"
        self.addCleanup(
            lambda: (
                os.environ.pop("RUNNER_CMD", None)
                if old_runner_cmd is None
                else os.environ.__setitem__("RUNNER_CMD", old_runner_cmd)
            )
        )

        svc = JobRunnerService()
        job = svc.create(req=self._key_request())

        key_path = os.path.join(job.workspace_dir, "id_rsa")
        self.assertTrue(os.path.isfile(key_path))

        mode = os.stat(key_path).st_mode & 0o777
        self.assertEqual(mode, 0o600)

        self._wait_for_terminal(svc, job.job_id)

    @patch("services.job_runner.service.build_inventory_preview")
    def test_private_key_removed_after_completion(self, m_preview) -> None:
        m_preview.return_value = (
            "all:\n  hosts:\n    localhost:\n      vars: {}\n",
            [],
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433

        old_runner_cmd = os.environ.get("RUNNER_CMD")
        os.environ["RUNNER_CMD"] = "true"
        self.addCleanup(
            lambda: (
                os.environ.pop("RUNNER_CMD", None)
                if old_runner_cmd is None
                else os.environ.__setitem__("RUNNER_CMD", old_runner_cmd)
            )
        )

        svc = JobRunnerService()
        job = svc.create(req=self._key_request())

        self._wait_for_terminal(svc, job.job_id)

        key_path = os.path.join(job.workspace_dir, "id_rsa")
        self.assertFalse(os.path.exists(key_path))

    @patch("services.job_runner.service.build_inventory_preview")
    def test_jobs_are_isolated(self, m_preview) -> None:
        m_preview.return_value = (
            "all:\n  hosts:\n    localhost:\n      vars: {}\n",
            [],
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433

        svc = JobRunnerService()
        job_a = svc.create(req=self._minimal_request())
        job_b = svc.create(req=self._minimal_request())

        self.assertNotEqual(job_a.job_id, job_b.job_id)
        self.assertNotEqual(job_a.workspace_dir, job_b.workspace_dir)
        self.assertTrue(os.path.isdir(job_a.workspace_dir))
        self.assertTrue(os.path.isdir(job_b.workspace_dir))
        self.assertNotEqual(
            os.path.realpath(job_a.workspace_dir),
            os.path.realpath(job_b.workspace_dir),
        )

        self._wait_for_terminal(svc, job_a.job_id)
        self._wait_for_terminal(svc, job_b.job_id)

    @patch("services.job_runner.service.build_inventory_preview")
    def test_restart_does_not_corrupt_jobs(self, m_preview) -> None:
        m_preview.return_value = (
            "all:\n  hosts:\n    localhost:\n      vars: {}\n",
            [],
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433

        svc = JobRunnerService()
        job = svc.create(req=self._minimal_request())

        # Simulate API restart by creating a fresh service instance.
        svc_restart = JobRunnerService()
        loaded = svc_restart.get(job.job_id)

        self.assertEqual(loaded.job_id, job.job_id)
        self.assertTrue(os.path.isfile(loaded.request_path))
        self.assertTrue(os.path.isfile(loaded.inventory_path))
        self.assertTrue(os.path.isfile(os.path.join(loaded.workspace_dir, "vars.json")))
        self.assertTrue(os.path.isfile(os.path.join(loaded.workspace_dir, "vars.yml")))

        self._wait_for_terminal(svc, job.job_id)

    def test_startup_purges_orphaned_secret_material(self) -> None:
        jobs_root = Path(self._tmp.name) / "jobs"
        job_dir = jobs_root / "orphan-job"
        secrets_dir = job_dir / "secrets"
        secrets_dir.mkdir(parents=True, exist_ok=True)
        (job_dir / "id_rsa").write_text("KEYDATA", encoding="utf-8")
        (secrets_dir / "ssh_password").write_text("supersecret", encoding="utf-8")
        (job_dir / "job.json").write_text(
            json.dumps({"status": "failed", "pid": None}),
            encoding="utf-8",
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433

        JobRunnerService()

        self.assertFalse((job_dir / "id_rsa").exists())
        self.assertFalse(secrets_dir.exists())

    @patch("services.job_runner.service.build_inventory_preview")
    def test_selected_roles_filter_is_kept_in_vars(self, m_preview) -> None:
        m_preview.return_value = (
            "all:\n  hosts:\n    localhost:\n      vars: {}\n",
            [],
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433
        from api.schemas.deployment import DeploymentRequest  # noqa: WPS433

        req = DeploymentRequest(
            workspace_id=self.workspace_id,
            host="localhost",
            user="tester",
            auth={"method": "password", "password": "x"},
            selected_roles=["custom-role-a", "custom-role-b"],
        )

        svc = JobRunnerService()
        job = svc.create(req=req)
        self._wait_for_terminal(svc, job.job_id)

        vars_path = Path(job.workspace_dir) / "vars.json"
        vars_data = json.loads(vars_path.read_text(encoding="utf-8"))
        self.assertEqual(
            vars_data.get("selected_roles"),
            ["custom-role-a", "custom-role-b"],
        )
        self.assertEqual(vars_data.get("ansible_password"), "<provided_at_runtime>")
        self.assertEqual(vars_data.get("ansible_ssh_pass"), "<provided_at_runtime>")
        self.assertEqual(
            vars_data.get("ansible_become_password"), "<provided_at_runtime>"
        )

    @patch("services.job_runner.service.discover_related_role_domains")
    @patch("services.job_runner.service.build_inventory_preview")
    def test_related_role_domains_are_written_to_host_vars(
        self,
        m_preview,
        m_related_domains,
    ) -> None:
        m_preview.return_value = (
            "all:\n  hosts:\n    localhost:\n      vars: {}\n",
            [],
        )
        m_related_domains.return_value = {
            "web-app-matomo": ["matomo.example.test"],
        }
        host_vars_dir = (
            Path(self._tmp.name) / "workspaces" / self.workspace_id / "host_vars"
        )
        host_vars_dir.mkdir(parents=True, exist_ok=True)
        (host_vars_dir / "device.yml").write_text(
            "DOMAIN_PRIMARY: example.test\n",
            encoding="utf-8",
        )

        from services.job_runner import JobRunnerService  # noqa: WPS433

        svc = JobRunnerService()
        job = svc.create(req=self._minimal_request())
        self._wait_for_terminal(svc, job.job_id)

        host_vars_path = Path(job.workspace_dir) / "host_vars" / "device.yml"
        host_vars_data = yaml.safe_load(host_vars_path.read_text(encoding="utf-8"))
        self.assertEqual(
            host_vars_data.get("domains"),
            {"web-app-matomo": ["matomo.example.test"]},
        )
        self.assertEqual(
            m_related_domains.call_args.kwargs["domain_primary"],
            "example.test",
        )
