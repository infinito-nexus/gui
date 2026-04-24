from ._container_runner_support import *  # noqa: F403


class TestContainerRunnerPart5(ContainerRunnerTestCase):
    def test_state_bind_mount_sources_use_host_state_path(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            container_state = tmp_path / "container-state" / "jobs"
            host_state = tmp_path / "host-state" / "jobs"
            job_dir = container_state / "abc123"
            secrets_dir = job_dir / "secrets"
            external_dir = tmp_path / "external"
            job_dir.mkdir(parents=True, exist_ok=True)
            secrets_dir.mkdir(parents=True, exist_ok=True)
            external_dir.mkdir(parents=True, exist_ok=True)

            old_state_dir = os.environ.get("STATE_DIR")
            old_state_host_path = os.environ.get("STATE_HOST_PATH")
            os.environ["STATE_DIR"] = str(container_state)
            os.environ["STATE_HOST_PATH"] = str(host_state)

            try:
                with patch(
                    "services.job_runner.container_runner.resolve_docker_bin",
                    return_value="docker",
                ):
                    cmd, _, _ = build_container_command(
                        job_id="abc123",
                        job_dir=job_dir,
                        cli_args=["infinito", "deploy", "dedicated"],
                        cfg=_make_cfg(),
                        bind_mounts=[
                            (str(secrets_dir), "/run/secrets/infinito", True),
                            (str(external_dir), "/external", False),
                        ],
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

            joined = "\n".join(cmd)
            self.assertIn(
                str(host_state / "abc123" / "secrets") + ":/run/secrets/infinito:ro",
                joined,
            )
            self.assertNotIn(
                str(container_state / "abc123" / "secrets")
                + ":/run/secrets/infinito:ro",
                joined,
            )
            self.assertIn(str(external_dir) + ":/external", joined)

    def test_declared_extra_mount_target_skips_duplicate_controller_shim(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            state_dir = tmp_path / "state" / "jobs"
            job_dir = state_dir / "abc123"
            job_dir.mkdir(parents=True, exist_ok=True)
            controller_bin = job_dir / "controller-bin"
            controller_bin.mkdir(parents=True, exist_ok=True)
            (controller_bin / "ldapsm").write_text("#!/bin/sh\n", encoding="utf-8")

            old_state_dir = os.environ.get("STATE_DIR")
            old_state_host_path = os.environ.get("STATE_HOST_PATH")
            os.environ["STATE_DIR"] = str(state_dir)
            os.environ["STATE_HOST_PATH"] = str(state_dir)

            try:
                with patch(
                    "services.job_runner.container_runner.resolve_docker_bin",
                    return_value="docker",
                ):
                    cmd, _, _ = build_container_command(
                        job_id="abc123",
                        job_dir=job_dir,
                        cli_args=["infinito", "deploy", "dedicated"],
                        cfg=_make_cfg(
                            extra_args=[
                                "-v",
                                "/custom/ldapsm:/usr/bin/ldapsm:ro",
                            ]
                        ),
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

            joined = "\n".join(cmd)
            self.assertIn("/custom/ldapsm:/usr/bin/ldapsm:ro", joined)
            self.assertNotIn(
                str(state_dir / "abc123" / "controller-bin" / "ldapsm")
                + ":/usr/bin/ldapsm:ro",
                joined,
            )
