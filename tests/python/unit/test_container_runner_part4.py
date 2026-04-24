from ._container_runner_support import *  # noqa: F403


class TestContainerRunnerPart4(ContainerRunnerTestCase):
    def test_build_container_command_rejects_host_network_in_hardened_mode(
        self,
    ) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            state_dir = tmp_path / "state" / "jobs"
            job_dir = state_dir / "abc123"
            job_dir.mkdir(parents=True, exist_ok=True)

            old_state_dir = os.environ.get("STATE_DIR")
            old_state_host_path = os.environ.get("STATE_HOST_PATH")
            os.environ["STATE_DIR"] = str(state_dir)
            os.environ["STATE_HOST_PATH"] = str(state_dir)

            cfg = _make_cfg(network="host")

            try:
                with patch(
                    "services.job_runner.container_runner.resolve_docker_bin",
                    return_value="docker",
                ):
                    with self.assertRaises(HTTPException) as ctx:
                        build_container_command(
                            job_id="abc123",
                            job_dir=job_dir,
                            cli_args=["infinito", "deploy", "dedicated"],
                            hardened=True,
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

            self.assertIn("must not use host networking", str(ctx.exception.detail))

    def test_build_container_command_rejects_extra_network_override_in_hardened_mode(
        self,
    ) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            state_dir = tmp_path / "state" / "jobs"
            job_dir = state_dir / "abc123"
            job_dir.mkdir(parents=True, exist_ok=True)

            old_state_dir = os.environ.get("STATE_DIR")
            old_state_host_path = os.environ.get("STATE_HOST_PATH")
            os.environ["STATE_DIR"] = str(state_dir)
            os.environ["STATE_HOST_PATH"] = str(state_dir)

            cfg = _make_cfg(
                network="job-123e4567-e89b-42d3-a456-426614174000",
                extra_args=["--network", "bridge"],
            )

            try:
                with patch(
                    "services.job_runner.container_runner.resolve_docker_bin",
                    return_value="docker",
                ):
                    with self.assertRaises(HTTPException) as ctx:
                        build_container_command(
                            job_id="abc123",
                            job_dir=job_dir,
                            cli_args=["infinito", "deploy", "dedicated"],
                            hardened=True,
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

            self.assertIn(
                "forbids overriding the dedicated job network",
                str(ctx.exception.detail),
            )

    def test_build_container_command_uses_dedicated_job_network_once(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            state_dir = tmp_path / "state" / "jobs"
            job_dir = state_dir / "abc123"
            job_dir.mkdir(parents=True, exist_ok=True)

            old_state_dir = os.environ.get("STATE_DIR")
            old_state_host_path = os.environ.get("STATE_HOST_PATH")
            os.environ["STATE_DIR"] = str(state_dir)
            os.environ["STATE_HOST_PATH"] = str(state_dir)

            cfg = _make_cfg(network="job-123e4567-e89b-42d3-a456-426614174000")

            try:
                with patch(
                    "services.job_runner.container_runner.resolve_docker_bin",
                    return_value="docker",
                ):
                    cmd, _, _ = build_container_command(
                        job_id="abc123",
                        job_dir=job_dir,
                        cli_args=["infinito", "deploy", "dedicated"],
                        hardened=True,
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

            network_indexes = [
                index for index, part in enumerate(cmd) if part == "--network"
            ]
            self.assertEqual(len(network_indexes), 1)
            self.assertEqual(
                cmd[network_indexes[0] + 1],
                "job-123e4567-e89b-42d3-a456-426614174000",
            )

    def test_optional_shim_mounts_use_job_dir_when_state_host_path_differs(
        self,
    ) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            container_state = tmp_path / "container-state" / "jobs"
            host_state = tmp_path / "host-state" / "jobs"
            job_dir = container_state / "abc123"
            job_dir.mkdir(parents=True, exist_ok=True)
            (job_dir / "baudolo-seed").write_text("#!/bin/sh\n", encoding="utf-8")
            (job_dir / "runner-passwd").write_text(
                "runner:x:10002:10002::/home/runner:/usr/bin/nologin\n",
                encoding="utf-8",
            )
            (job_dir / "runner-group").write_text(
                "runner:x:10002:\n",
                encoding="utf-8",
            )
            (job_dir / "runner-sudoers").write_text(
                "runner ALL=(ALL) NOPASSWD:ALL\n",
                encoding="utf-8",
            )
            controller_bin = job_dir / "controller-bin"
            controller_bin.mkdir(parents=True, exist_ok=True)
            (controller_bin / "ldapsm").write_text("#!/bin/sh\n", encoding="utf-8")

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
                str(host_state / "abc123" / "baudolo-seed")
                + ":/usr/local/bin/baudolo-seed:ro",
                joined,
            )
            self.assertIn(
                str(host_state / "abc123" / "controller-bin" / "ldapsm")
                + ":/usr/bin/ldapsm:ro",
                joined,
            )
            self.assertIn(
                str(host_state / "abc123" / "runner-passwd") + ":/etc/passwd:ro",
                joined,
            )
            self.assertIn(
                str(host_state / "abc123" / "runner-group") + ":/etc/group:ro",
                joined,
            )
            self.assertIn(
                str(host_state / "abc123" / "runner-sudoers")
                + ":/etc/sudoers.d/infinito-runner:ro",
                joined,
            )
