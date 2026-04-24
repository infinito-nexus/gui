from ._container_runner_support import *  # noqa: F403


class TestContainerRunnerPart3(ContainerRunnerTestCase):
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
