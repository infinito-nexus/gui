import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi import HTTPException

from services.job_runner.container_runner import (
    ContainerRunnerConfig,
    build_container_command,
    create_internal_network,
    inspect_container_labels,
    load_container_config,
    remove_network,
    stop_container,
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

    def test_build_container_command_supports_hardening_flags(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            state_dir = tmp_path / "state" / "jobs"
            job_dir = state_dir / "abc123"
            job_dir.mkdir(parents=True, exist_ok=True)

            old_state_dir = os.environ.get("STATE_DIR")
            old_state_host_path = os.environ.get("STATE_HOST_PATH")
            os.environ["STATE_DIR"] = str(state_dir)
            os.environ["STATE_HOST_PATH"] = str(state_dir)

            cfg = _make_cfg(network="infinito-deployer")

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
                            "INFINITO_SECRETS_DIR": "/run/secrets/infinito",
                            "INFINITO_WAIT_FOR_SECRETS_READY": "1",
                            "INFINITO_SECRETS_READY_FILE": "/run/secrets/infinito/.ready",
                        },
                        labels={
                            "infinito.deployer.job_id": "abc123",
                            "infinito.deployer.workspace_id": "workspace-1",
                            "infinito.deployer.role": "job-runner",
                        },
                        container_user="10002:10002",
                        read_only_root=True,
                        tmpfs_mounts=["/tmp:rw,noexec,nosuid,nodev,size=64m"],
                        volume_mounts=[
                            ("job-secrets-abc123", "/run/secrets/infinito", True),
                        ],
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

            self.assertIn("--user", cmd)
            self.assertIn("10002:10002", cmd)
            self.assertIn("--read-only", cmd)
            self.assertIn("--cap-drop", cmd)
            self.assertIn("ALL", cmd)
            self.assertIn("--security-opt", cmd)
            self.assertIn("no-new-privileges:true", cmd)
            self.assertIn("--tmpfs", cmd)
            self.assertIn("job-secrets-abc123:/run/secrets/infinito:ro", cmd)
            self.assertTrue(
                any(
                    part == "infinito.deployer.workspace_id=workspace-1" for part in cmd
                )
            )
            self.assertIn("INFINITO_SECRETS_DIR=/run/secrets/infinito", cmd)
            self.assertIn("INFINITO_WAIT_FOR_SECRETS_READY=1", cmd)
            self.assertIn(
                "INFINITO_SECRETS_READY_FILE=/run/secrets/infinito/.ready",
                cmd,
            )
            self.assertNotIn("INFINITO_RUNTIME_PASSWORD=deploy", cmd)
            self.assertNotIn("INFINITO_RUNTIME_SSH_PASS=secret-passphrase", cmd)
            self.assertNotIn("INFINITO_RUNTIME_VAULT_PASSWORD=vault-secret", cmd)
            self.assertTrue(
                any(
                    'export ANSIBLE_VAULT_PASSWORD_FILE="${secrets_dir}/vault_password"'
                    in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    'runtime_secrets_file="${runtime_secrets_dir}/_secrets.yml"' in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    'runtime_ssh_key_file="/tmp/infinito-runtime-ssh-key"' in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    'secrets_ready_file="${INFINITO_SECRETS_READY_FILE:-${secrets_dir}/.ready}"'
                    in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    'if [ -n "${secrets_dir}" ] && [ "${INFINITO_WAIT_FOR_SECRETS_READY:-0}" = "1" ]; then'
                    in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    'echo "ERROR: timed out waiting for runner secrets bootstrap at ${secrets_ready_file}" >&2'
                    in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    'if [ -n "${secrets_dir}" ] && [ -f "${secrets_dir}/vault_password" ]; then'
                    in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    'export INFINITO_RUNTIME_SSH_KEY_FILE="${runtime_ssh_key_file}"'
                    in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    'cp "${secrets_dir}/ssh_key" "${runtime_ssh_key_file}"' in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    'lines.append(f"ansible_ssh_private_key_file: {runtime_ssh_key_file}")'
                    in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    'workspace_inventory_root="$(dirname "${workspace_inventory}")"'
                    in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    'cp "${workspace_inventory}" "${runtime_inventory_file}"' in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    'cp -a "${workspace_inventory_root}/host_vars/." "${runtime_host_vars_dir}/"'
                    in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    'cp -a "${workspace_inventory_root}/group_vars/." "${runtime_group_vars_dir}/"'
                    in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    "ansible_password: \\\"{{ lookup('file', '/run/secrets/infinito/ssh_password') }}\\\""
                    in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    "ansible_ssh_pass: \\\"{{ lookup('file', '/run/secrets/infinito/ssh_password') }}\\\""
                    in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    "ansible_become_pass: \\\"{{ lookup('file', '/run/secrets/infinito/ssh_password') }}\\\""
                    in part
                    for part in cmd
                )
            )
            self.assertTrue(
                any(
                    "ansible_become_password: \\\"{{ lookup('file', '/run/secrets/infinito/ssh_password') }}\\\""
                    in part
                    for part in cmd
                )
            )

    def test_build_container_command_rejects_privileged_hardening_bypass(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            state_dir = tmp_path / "state" / "jobs"
            job_dir = state_dir / "abc123"
            job_dir.mkdir(parents=True, exist_ok=True)

            old_state_dir = os.environ.get("STATE_DIR")
            old_state_host_path = os.environ.get("STATE_HOST_PATH")
            os.environ["STATE_DIR"] = str(state_dir)
            os.environ["STATE_HOST_PATH"] = str(state_dir)

            cfg = _make_cfg(extra_args=["--privileged"])

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

            self.assertIn("forbids docker arg --privileged", str(ctx.exception.detail))

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
