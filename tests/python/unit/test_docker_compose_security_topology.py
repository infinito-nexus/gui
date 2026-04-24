import unittest
from pathlib import Path

import yaml


class TestDockerComposeSecurityTopology(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        compose_path = repo_root / "docker-compose.yml"
        cls.compose = yaml.safe_load(compose_path.read_text(encoding="utf-8"))

    def test_runner_manager_service_owns_docker_socket(self) -> None:
        services = self.compose["services"]
        for service_name, service in services.items():
            volumes = service.get("volumes", [])
            has_socket = any(
                "/var/run/docker.sock" in str(volume) for volume in volumes
            )
            if service_name == "runner-manager":
                self.assertTrue(has_socket)
            else:
                self.assertFalse(has_socket, service_name)

        runner_manager = services["runner-manager"]
        self.assertEqual(
            runner_manager["user"],
            "10003:${DOCKER_SOCKET_GID:-10900}",
        )
        self.assertEqual(runner_manager["group_add"], ["10900"])

    def test_manager_auth_volume_is_shared_read_only(self) -> None:
        services = self.compose["services"]
        api_volumes = services["api"]["volumes"]
        manager_volumes = services["runner-manager"]["volumes"]
        init_volumes = services["init-manager-token"]["volumes"]

        self.assertTrue(
            any("manager_auth:/run/manager:ro" == volume for volume in api_volumes)
        )
        self.assertTrue(
            any("manager_auth:/run/manager:ro" == volume for volume in manager_volumes)
        )
        self.assertTrue(any("manager_auth:/auth" == volume for volume in init_volumes))

    def test_runner_manager_internal_api_shape_is_declared(self) -> None:
        services = self.compose["services"]
        manager_service = services["runner-manager"]
        api_env = services["api"]["environment"]

        self.assertEqual(
            manager_service["command"],
            [
                "sh",
                "-lc",
                "umask 0002 && exec uvicorn manager_main:app --host 0.0.0.0 --port 8001",
            ],
        )
        self.assertEqual(
            services["api"]["command"],
            [
                "sh",
                "-lc",
                'umask 0002 && exec uvicorn main:app --host 0.0.0.0 --port "${API_APP_PORT:-8000}"',
            ],
        )
        self.assertEqual(
            api_env["RUNNER_MANAGER_URL"],
            "${RUNNER_MANAGER_URL:-http://runner-manager:8001}",
        )
        self.assertEqual(
            api_env["MANAGER_TOKEN_FILE"],
            "${MANAGER_TOKEN_FILE:-/run/manager/token}",
        )
        self.assertNotIn("ports", manager_service)

    def test_init_manager_token_declares_rotation_command(self) -> None:
        init_service = self.compose["services"]["init-manager-token"]
        command = "\n".join(init_service["command"])

        self.assertIn("openssl rand -hex 32", command)
        self.assertIn('token="$$(openssl rand -hex 32)"', command)
        self.assertIn("printf '%s\\n' \"$${token}\" > /auth/token", command)
        self.assertIn("install -d -o 10003 -g 10900 -m 0750 /auth", command)
        self.assertIn("chown 10003:10900 /auth/token", command)
        self.assertIn("chmod 0440 /auth/token", command)
        self.assertNotIn("if [ -f /auth/token ]", command)

    def test_init_state_perms_prepares_state_tree_for_non_root_services(self) -> None:
        services = self.compose["services"]
        init_service = services["init-state-perms"]
        command = "\n".join(init_service["command"])
        environment = init_service["environment"]

        self.assertEqual(init_service["user"], "0:0")
        self.assertTrue(
            any("${STATE_HOST_PATH}:${STATE_DIR}" == v for v in init_service["volumes"])
        )
        self.assertEqual(environment["STATE_HOST_UID"], "${STATE_HOST_UID:-}")
        self.assertEqual(environment["STATE_HOST_GID"], "${STATE_HOST_GID:-}")
        self.assertIn('state_uid="$${STATE_HOST_UID:-$$(stat -c', command)
        self.assertIn('state_gid="$${STATE_HOST_GID:-$$(stat -c', command)
        self.assertIn(
            'install -d -o "$${state_uid}" -g "$${state_gid}" -m 0755 "$${STATE_DIR}"',
            command,
        )
        self.assertIn("install -d -o 10001 -g 10900 -m 2770", command)
        self.assertIn('"$${STATE_DIR}/workspaces"', command)
        self.assertIn('"$${STATE_DIR}/jobs"', command)
        self.assertIn("install -d -o 10001 -g 10900 -m 0755", command)
        self.assertIn('"$${STATE_DIR}/catalog"', command)

        self.assertEqual(
            services["api"]["depends_on"]["init-state-perms"]["condition"],
            "service_completed_successfully",
        )
        self.assertEqual(
            services["runner-manager"]["depends_on"]["init-state-perms"]["condition"],
            "service_completed_successfully",
        )

    def test_healthchecks_exist_for_documented_services(self) -> None:
        services = self.compose["services"]

        for service_name in ("api", "web", "db", "catalog", "runner-manager"):
            self.assertIn("healthcheck", services[service_name], service_name)

    def test_runtime_services_drop_caps_and_set_no_new_privileges(self) -> None:
        services = self.compose["services"]

        for service_name in ("api", "web", "catalog", "runner-manager"):
            self.assertEqual(services[service_name]["cap_drop"], ["ALL"], service_name)
        for service_name in ("api", "web", "db", "catalog", "runner-manager"):
            self.assertEqual(
                services[service_name]["security_opt"],
                ["no-new-privileges:true"],
                service_name,
            )

    def test_runtime_services_use_read_only_root_where_supported(self) -> None:
        services = self.compose["services"]

        for service_name in ("api", "web", "catalog", "runner-manager"):
            self.assertTrue(services[service_name]["read_only"], service_name)

    def test_catalog_uses_tmpfs_python_fallback_instead_of_apt_writes(self) -> None:
        catalog_env = self.compose["services"]["catalog"]["environment"]
        api_env = self.compose["services"]["api"]["environment"]
        catalog_service = self.compose["services"]["catalog"]
        command = "\n".join(catalog_service["command"])
        healthcheck = catalog_service["healthcheck"]["test"][1]

        self.assertEqual(catalog_env["CATALOG_DIR"], "${STATE_DIR}/catalog")
        self.assertEqual(
            api_env["ROLE_CATALOG_LIST_JSON"],
            "${STATE_DIR}/catalog/roles/list.json",
        )
        self.assertIn('mkdir -p "$${CATALOG_DIR}/roles"', command)
        self.assertIn(
            'echo "→ Generating invokable roles list into $${CATALOG_DIR}/roles/list.json"',
            command,
        )
        self.assertIn('> "$${CATALOG_DIR}/roles/list.json"', command)
        self.assertEqual(healthcheck, 'test -s "$$CATALOG_DIR/roles/list.json"')
        self.assertIn(
            'python3 -m pip install --disable-pip-version-check --no-cache-dir --target "$${catalog_pylib}" pyyaml >/dev/null',
            command,
        )
        self.assertIn('pythonpath_prefix="$${catalog_pylib}:"', command)
        self.assertNotIn(
            "apt-get install -y --no-install-recommends python3-yaml", command
        )

    def test_ssh_password_target_uses_explicit_caps_instead_of_privileged(self) -> None:
        ssh_password = self.compose["services"]["ssh-password"]

        self.assertNotIn("privileged", ssh_password)
        self.assertEqual(
            ssh_password["sysctls"],
            {
                "net.ipv6.conf.all.disable_ipv6": 0,
                "net.ipv6.conf.default.disable_ipv6": 0,
                "net.ipv6.conf.lo.disable_ipv6": 0,
            },
        )
        self.assertEqual(ssh_password["cap_add"], ["ALL"])
        self.assertEqual(
            ssh_password["security_opt"],
            ["apparmor=unconfined", "seccomp=unconfined"],
        )

    def test_default_network_pins_lower_mtu_for_nested_e2e_tls_pulls(self) -> None:
        default_network = self.compose["networks"]["default"]

        self.assertEqual(default_network["name"], "${DOCKER_NETWORK_NAME}")
        self.assertEqual(
            default_network["driver_opts"],
            {"com.docker.network.driver.mtu": "1400"},
        )
        self.assertEqual(
            default_network["ipam"]["config"],
            [{"subnet": "${DOCKER_NETWORK_SUBNET:-172.28.0.0/24}"}],
        )
