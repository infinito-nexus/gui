from __future__ import annotations

import json
import subprocess
import time
import unittest
from typing import Any

import httpx

from .perf_support import REPO_ROOT, api_base_url, compose_ps_quiet, web_base_url
from ._security_helpers import (
    RUNNER_PLAYBOOK,
    SECRET_VALUE,
    STACK_SERVICES,
    docker_output as _docker_output,
    raise_for_status_verbose as _raise_for_status_verbose,
    run_make as _run_make,
    wait_for_http_ready as _wait_for_http_ready,
)


class TestSecurityHardening(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._started_here = False
        required = ("api", "runner-manager", "web", "ssh-password")
        if any(not compose_ps_quiet(service) for service in required):
            _run_make("test-up", f"TEST_UP_SERVICES={STACK_SERVICES}")
            cls._started_here = True
        _wait_for_http_ready(f"{api_base_url()}/health")
        _wait_for_http_ready(web_base_url())

    @classmethod
    def tearDownClass(cls) -> None:
        if cls._started_here:
            subprocess.run(
                ["make", "test-env-down"],
                cwd=str(REPO_ROOT),
                check=False,
                text=True,
            )

    def _prime_csrf(self, client: httpx.Client) -> dict[str, str]:
        response = client.get("/health")
        _raise_for_status_verbose(response)
        token = str(client.cookies.get("csrf") or "").strip()
        self.assertTrue(token, "csrf cookie must be issued for anonymous sessions")
        return {"X-CSRF": token, "Cookie": f"csrf={token}"}

    def _create_workspace(self, client: httpx.Client) -> str:
        response = client.post("/api/workspaces", headers=self._prime_csrf(client))
        _raise_for_status_verbose(response)
        workspace_id = str(response.json().get("workspace_id") or "").strip()
        self.assertTrue(workspace_id)
        return workspace_id

    def _write_workspace_file(
        self,
        client: httpx.Client,
        workspace_id: str,
        path: str,
        content: str,
    ) -> None:
        response = client.put(
            f"/api/workspaces/{workspace_id}/files/{path}",
            json={"content": content},
            headers=self._prime_csrf(client),
        )
        _raise_for_status_verbose(response)

    def _generate_inventory(self, client: httpx.Client, workspace_id: str) -> None:
        response = client.post(
            f"/api/workspaces/{workspace_id}/generate-inventory",
            json={
                "alias": "target",
                "host": "ssh-password",
                "port": 22,
                "user": "integration",
                "auth_method": "password",
                "selected_roles": ["web-app-dashboard"],
            },
            headers=self._prime_csrf(client),
        )
        _raise_for_status_verbose(response)

    def _create_deployment(self, client: httpx.Client, workspace_id: str) -> str:
        response = client.post(
            "/api/deployments",
            json={
                "workspace_id": workspace_id,
                "host": "ssh-password",
                "port": 22,
                "user": "integration",
                "auth": {"method": "password", "password": SECRET_VALUE},
                "selected_roles": [],
                "playbook_path": "playbooks/security_wait.yml",
                "limit": "target",
            },
            headers=self._prime_csrf(client),
        )
        _raise_for_status_verbose(response)
        job_id = str(response.json().get("job_id") or "").strip()
        self.assertTrue(job_id)
        return job_id

    def _cancel_deployment(self, client: httpx.Client, job_id: str) -> None:
        response = client.post(
            f"/api/deployments/{job_id}/cancel",
            headers=self._prime_csrf(client),
        )
        _raise_for_status_verbose(response)

    def _deployment(self, client: httpx.Client, job_id: str) -> dict[str, Any]:
        response = client.get(f"/api/deployments/{job_id}")
        _raise_for_status_verbose(response)
        payload = response.json()
        self.assertIsInstance(payload, dict)
        return payload

    def _wait_for_status(
        self,
        client: httpx.Client,
        job_id: str,
        *,
        allowed_statuses: set[str],
        timeout_seconds: float = 60.0,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        last_payload: dict[str, Any] | None = None
        while time.monotonic() < deadline:
            payload = self._deployment(client, job_id)
            last_payload = payload
            status = str(payload.get("status") or "").strip().lower()
            if status in allowed_statuses:
                return payload
            time.sleep(1.0)
        raise AssertionError(
            f"deployment {job_id} did not reach {allowed_statuses}; last={last_payload}"
        )

    def _wait_until(self, predicate, *, timeout_seconds: float, message: str) -> None:
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.5)
        raise AssertionError(message)

    def _docker_exists(self, name: str, *, kind: str = "container") -> bool:
        args = [kind, "inspect", name] if kind == "network" else ["inspect", name]
        result = subprocess.run(
            ["docker", *args],
            cwd=str(REPO_ROOT),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
        )
        return result.returncode == 0

    def _collect_sse_payloads(self, job_id: str) -> list[dict[str, Any]]:
        payloads: list[dict[str, Any]] = []
        with httpx.Client(base_url=api_base_url(), timeout=30.0) as client:
            with client.stream(
                "GET",
                f"/api/deployments/{job_id}/logs",
                headers={"Accept": "text/event-stream"},
            ) as response:
                _raise_for_status_verbose(response)
                buffer = ""
                for chunk in response.iter_text():
                    buffer += chunk.replace("\r\n", "\n").replace("\r", "\n")
                    while "\n\n" in buffer:
                        raw_frame, buffer = buffer.split("\n\n", 1)
                        if not raw_frame.strip():
                            continue
                        data_lines = [
                            line[5:].lstrip()
                            for line in raw_frame.split("\n")
                            if line.startswith("data:")
                        ]
                        if not data_lines:
                            continue
                        payload = json.loads("\n".join(data_lines))
                        payloads.append(payload)
                        if str(payload.get("type") or "") == "done":
                            return payloads
        return payloads

    def test_concurrent_deployments_use_distinct_hardened_runners_and_cleanup(
        self,
    ) -> None:
        with httpx.Client(base_url=api_base_url(), timeout=30.0) as client:
            workspace_id = self._create_workspace(client)
            self._write_workspace_file(
                client,
                workspace_id,
                "playbooks/security_wait.yml",
                RUNNER_PLAYBOOK,
            )
            self._generate_inventory(client, workspace_id)

            job_one = self._create_deployment(client, workspace_id)
            job_two = self._create_deployment(client, workspace_id)

            running_one = self._wait_for_status(
                client,
                job_one,
                allowed_statuses={"running"},
            )
            running_two = self._wait_for_status(
                client,
                job_two,
                allowed_statuses={"running"},
            )

            container_one = str(running_one.get("container_id") or "").strip()
            container_two = str(running_two.get("container_id") or "").strip()
            self.assertTrue(container_one)
            self.assertTrue(container_two)
            self.assertNotEqual(container_one, container_two)
            self._wait_until(
                lambda: self._docker_exists(container_one),
                timeout_seconds=10.0,
                message="first runner container should become inspectable",
            )
            self._wait_until(
                lambda: self._docker_exists(container_two),
                timeout_seconds=10.0,
                message="second runner container should become inspectable",
            )

            inspect_payload = json.loads(_docker_output("inspect", container_one))[0]
            self.assertTrue(inspect_payload["HostConfig"]["ReadonlyRootfs"])
            self.assertIn("ALL", inspect_payload["HostConfig"]["CapDrop"])
            networks = inspect_payload["NetworkSettings"]["Networks"]
            self.assertEqual(set(networks.keys()), {f"job-{job_one}"})
            self.assertNotIn("bridge", networks)
            secret_mounts = [
                mount
                for mount in inspect_payload.get("Mounts", [])
                if mount.get("Destination") == "/run/secrets/infinito"
            ]
            self.assertEqual(len(secret_mounts), 1)
            self.assertEqual(secret_mounts[0].get("Type"), "volume")
            self.assertFalse(bool(secret_mounts[0].get("RW")))
            self.assertTrue(
                str(secret_mounts[0].get("Name") or "").startswith(
                    f"infinito-job-secrets-{job_one}"
                )
            )

            self.assertEqual(
                _docker_output(
                    "network", "inspect", f"job-{job_one}", "--format", "{{.Internal}}"
                ),
                "true",
            )

            live_runner_log = _docker_output(
                "exec",
                "infinito-deployer-api",
                "sh",
                "-lc",
                f'tail -n 120 "${{STATE_DIR}}/jobs/{job_one}/job.log"',
            )
            self.assertIn("lookup", live_runner_log)
            self.assertIn("/run/secrets/infinito/ssh_password", live_runner_log)
            self.assertNotIn(SECRET_VALUE, live_runner_log)

            host_secret_meta = _docker_output(
                "exec",
                "infinito-deployer-api",
                "sh",
                "-lc",
                (
                    f"stat -c '%a' \"${{STATE_DIR}}/jobs/{job_one}/secrets\""
                    f" && stat -c '%a' \"${{STATE_DIR}}/jobs/{job_one}/secrets/ssh_password\""
                ),
            ).splitlines()
            self.assertEqual(host_secret_meta, ["700", "400"])

            runner_secret_meta = _docker_output(
                "exec",
                "-u",
                "10002:10002",
                container_one,
                "sh",
                "-lc",
                (
                    "test -r /run/secrets/infinito/ssh_password"
                    ' && printf "%s\\n" "$(wc -c < /run/secrets/infinito/ssh_password)"'
                    ' && stat -c "%u:%g %a" /run/secrets/infinito/ssh_password'
                ),
            ).splitlines()
            self.assertEqual(
                runner_secret_meta, [str(len(SECRET_VALUE)), "10002:10002 400"]
            )

            self._cancel_deployment(client, job_one)
            self._cancel_deployment(client, job_two)
            terminal_one = self._wait_for_status(
                client,
                job_one,
                allowed_statuses={"canceled", "failed", "succeeded"},
            )
            self._wait_for_status(
                client,
                job_two,
                allowed_statuses={"canceled", "failed", "succeeded"},
            )

        self.assertEqual(str(terminal_one.get("status") or "").lower(), "canceled")
        sse_payloads = self._collect_sse_payloads(job_one)
        self.assertTrue(sse_payloads)
        for payload in sse_payloads:
            if str(payload.get("type") or "") != "log":
                continue
            line = str(payload.get("line") or "")
            self.assertTrue(line.startswith("[RX:"), line)
            self.assertNotIn(SECRET_VALUE, line)

        persisted_log = _docker_output(
            "exec",
            "infinito-deployer-api",
            "sh",
            "-lc",
            f'cat "${{STATE_DIR}}/jobs/{job_one}/job.log"',
        )
        self.assertIn("[RX:", persisted_log)
        self.assertNotIn(SECRET_VALUE, persisted_log)

        self._wait_until(
            lambda: not self._docker_exists(container_one),
            timeout_seconds=15.0,
            message="runner container should be removed after terminal state",
        )
        self._wait_until(
            lambda: not self._docker_exists(f"job-{job_one}", kind="network"),
            timeout_seconds=10.0,
            message="job network should be removed after terminal state",
        )
        self._wait_until(
            lambda: (
                _docker_output(
                    "exec",
                    "infinito-deployer-api",
                    "sh",
                    "-lc",
                    f'test ! -e "${{STATE_DIR}}/jobs/{job_one}/secrets" && echo gone',
                    check=False,
                )
                == "gone"
            ),
            timeout_seconds=10.0,
            message="secret directory should be cleaned up after terminal state",
        )

    def test_csrf_cors_and_csp_controls_are_enforced(self) -> None:
        with httpx.Client(base_url=api_base_url(), timeout=30.0) as api_client:
            priming = api_client.get("/health")
            _raise_for_status_verbose(priming)
            set_cookie = priming.headers.get("set-cookie", "").lower()
            self.assertIn("csrf=", set_cookie)
            self.assertIn("secure", set_cookie)
            self.assertIn("samesite=strict", set_cookie)
            self.assertNotIn("httponly", set_cookie)

            rejected = api_client.post("/api/workspaces")
            self.assertEqual(rejected.status_code, 403)

            allowed = api_client.post(
                "/api/workspaces",
                headers=self._prime_csrf(api_client),
            )
            _raise_for_status_verbose(allowed)

            cors = api_client.options(
                "/api/workspaces",
                headers={
                    "Origin": "https://evil.example",
                    "Access-Control-Request-Method": "POST",
                },
            )
            self.assertNotEqual(
                cors.headers.get("access-control-allow-origin"),
                "https://evil.example",
            )

        with httpx.Client(base_url=web_base_url(), timeout=30.0) as web_client:
            response_a = web_client.get("/")
            _raise_for_status_verbose(response_a)
            response_b = web_client.get("/")
            _raise_for_status_verbose(response_b)

        nonce_a = response_a.headers.get("x-nonce", "")
        nonce_b = response_b.headers.get("x-nonce", "")
        self.assertTrue(nonce_a)
        self.assertTrue(nonce_b)
        self.assertNotEqual(nonce_a, nonce_b)
        self.assertIn(
            f"'nonce-{nonce_a}'", response_a.headers["content-security-policy"]
        )
        self.assertIn(
            "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
            response_a.headers["content-security-policy"],
        )

    def test_z_manager_token_rotates_on_restart(self) -> None:
        token_before = _docker_output(
            "exec",
            "infinito-deployer-api",
            "sh",
            "-lc",
            "cat /run/manager/token",
        )
        self.assertTrue(token_before)

        _run_make("restart")
        _wait_for_http_ready(f"{api_base_url()}/health")

        token_after = _docker_output(
            "exec",
            "infinito-deployer-api",
            "sh",
            "-lc",
            "cat /run/manager/token",
        )
        self.assertTrue(token_after)
        self.assertNotEqual(token_before, token_after)


if __name__ == "__main__":
    unittest.main()
