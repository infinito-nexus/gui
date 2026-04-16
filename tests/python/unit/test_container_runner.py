import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from services.job_runner.container_runner import (
    ContainerRunnerConfig,
    build_container_command,
    load_container_config,
)


def _make_cfg(**overrides) -> ContainerRunnerConfig:
    defaults = dict(
        image="infinito-arch",
        repo_dir="/opt/src/infinito",
        workdir="/workspace",
        network=None,
        extra_args=[],
        skip_cleanup=False,
        skip_build=False,
    )
    defaults.update(overrides)
    return ContainerRunnerConfig(**defaults)


class TestContainerRunner(unittest.TestCase):
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

    def test_build_container_command_passes_runtime_secret_env(self) -> None:
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
            self.assertFalse(any(":ro" in part for part in cmd))
            self.assertIn("--entrypoint", cmd)
            self.assertIn("/bin/bash", cmd)
            self.assertTrue(
                any('exec "$@" -e "@${runtime_vars_file}"' in part for part in cmd)
            )
            self.assertTrue(
                any(
                    "ln -sf /workspace/baudolo-seed /usr/local/bin/baudolo-seed" in part
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
                any(
                    'export PATH=/workspace:"${runtime_bin_dir}":$PATH' in part
                    for part in cmd
                )
            )
            self.assertFalse(any("cp -a" in part for part in cmd))
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
