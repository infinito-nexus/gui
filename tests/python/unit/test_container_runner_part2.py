from ._container_runner_support import *  # noqa: F403


class TestContainerRunnerPart2(ContainerRunnerTestCase):
    def test_build_container_command_passes_runtime_secret_env(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            state_dir = tmp_path / "state" / "jobs"
            job_dir = state_dir / "abc123"
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
                        runtime_env={
                            "INFINITO_RUNTIME_PASSWORD": "deploy",
                            "INFINITO_RUNTIME_SSH_PASS": "secret-passphrase",
                            "INFINITO_RUNTIME_VAULT_PASSWORD": "vault-secret",
                        },
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

            self.assertIn("INFINITO_RUNTIME_PASSWORD=deploy", cmd)
            self.assertIn("INFINITO_RUNTIME_SSH_PASS=secret-passphrase", cmd)
            self.assertIn("INFINITO_RUNTIME_VAULT_PASSWORD=vault-secret", cmd)
            self.assertIn("JOB_RUNNER_REPO_DIR=/opt/src/infinito", cmd)
            self.assertNotIn("JOB_RUNNER_REPO_MOUNT_DIR", " ".join(cmd))
            self.assertFalse(any("/run/secrets/infinito:ro" in part for part in cmd))
            self.assertIn("--entrypoint", cmd)
            self.assertIn("/bin/bash", cmd)
            self.assertTrue(
                any('exec "$@" -e "@${runtime_vars_file}"' in part for part in cmd)
            )
            self.assertTrue(
                any(
                    part.endswith("/baudolo-seed:/usr/local/bin/baudolo-seed:ro")
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    part.endswith("/controller-bin/ldapsm:/usr/bin/ldapsm:ro")
                    for part in cmd
                )
            )
            self.assertTrue(
                any(part.endswith("/runner-passwd:/etc/passwd:ro") for part in cmd)
            )
            self.assertTrue(
                any(part.endswith("/runner-group:/etc/group:ro") for part in cmd)
            )
            self.assertTrue(
                any(
                    part.endswith("/runner-sudoers:/etc/sudoers.d/infinito-runner:ro")
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    'runtime_python="${PYTHON:-/opt/venvs/infinito/bin/python}"' in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    'runtime_bin_dir="$(dirname "${runtime_python}")"' in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any('runtime_home="/tmp/infinito-home"' in part for part in cmd)
            )
            self.assertTrue(
                any('export HOME="${runtime_home}"' in part for part in cmd)
            )
            self.assertTrue(
                any(
                    'export ANSIBLE_LOCAL_TEMP="${runtime_home}/.ansible/tmp"' in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    'export PATH=/workspace:"${runtime_bin_dir}":$PATH' in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    'runtime_repo_root="/run/infinito-repo/repo"' in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    'cp -a "${source_repo_root}/." "${runtime_repo_root}/"' in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    "find \"${runtime_repo_root}/scripts\" -type f -name '*.sh' -exec chmod 755 {} +"
                    in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any('export JOB_RUNNER_REPO_DIR="${repo_root}"' in part for part in cmd)
            )
            self.assertTrue(
                any('export PYTHONPATH="${repo_root}"' in part for part in cmd)
            )
            self.assertTrue(
                any(
                    'data["ansible_become_password"] = password' in part for part in cmd
                )
            )
            self.assertTrue(
                any(
                    'export ANSIBLE_VAULT_PASSWORD_FILE="${runtime_vault_file}"' in part
                    for part in cmd
                )
            )
