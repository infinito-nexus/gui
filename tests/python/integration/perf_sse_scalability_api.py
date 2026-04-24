from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from .perf_sse_scalability_support import (
    PERF_MASK_PASSWORD,
    PERF_MASK_USER,
    REPO_ROOT,
    ROLE_LOAD_BURST_SIZE,
    STREAM_TIMEOUT_SECONDS,
)


class PerfSseScalabilityApiMixin:
    async def _warm_role_index(self, client: httpx.AsyncClient) -> None:
        for _ in range(5):
            response = await client.get("/api/roles")
            response.raise_for_status()

    async def _prime_csrf(self, client: httpx.AsyncClient) -> dict[str, str]:
        response = await client.get("/health")
        response.raise_for_status()
        token = str(client.cookies.get("csrf") or "").strip()
        self.assertTrue(token, "anonymous perf client must receive a csrf cookie")
        return {"X-CSRF": token, "Cookie": f"csrf={token}"}

    async def _create_workspace(self, client: httpx.AsyncClient) -> str:
        csrf_headers = await self._prime_csrf(client)
        response = await client.post("/api/workspaces", headers=csrf_headers)
        response.raise_for_status()
        workspace_id = str(response.json().get("workspace_id") or "").strip()
        self.assertTrue(workspace_id, "workspace creation must return an id")
        return workspace_id

    async def _upload_playbook_fixture(
        self, client: httpx.AsyncClient, workspace_id: str
    ) -> None:
        playbook_text = (
            REPO_ROOT / "tests" / "fixtures" / "perf" / "emit_lines.yml"
        ).read_text(encoding="utf-8")
        csrf_headers = await self._prime_csrf(client)
        response = await client.put(
            f"/api/workspaces/{workspace_id}/files/playbooks/emit_lines.yml",
            json={"content": playbook_text},
            headers=csrf_headers,
        )
        response.raise_for_status()

    async def _generate_inventory(
        self, client: httpx.AsyncClient, workspace_id: str
    ) -> None:
        csrf_headers = await self._prime_csrf(client)
        response = await client.post(
            f"/api/workspaces/{workspace_id}/generate-inventory",
            json={
                "alias": "target",
                "host": "ssh-password",
                "port": 22,
                "user": PERF_MASK_USER,
                "auth_method": "password",
                "selected_roles": ["web-app-dashboard"],
            },
            headers=csrf_headers,
        )
        response.raise_for_status()

    async def _create_fixture_deployment(
        self, client: httpx.AsyncClient, workspace_id: str
    ) -> str:
        csrf_headers = await self._prime_csrf(client)
        response = await client.post(
            "/api/deployments",
            json={
                "workspace_id": workspace_id,
                "host": "ssh-password",
                "port": 22,
                "user": PERF_MASK_USER,
                "auth": {"method": "password", "password": PERF_MASK_PASSWORD},
                "selected_roles": [],
                "playbook_path": "playbooks/emit_lines.yml",
                "limit": "target",
            },
            headers=csrf_headers,
        )
        response.raise_for_status()
        job_id = str(response.json().get("job_id") or "").strip()
        self.assertTrue(job_id, "deployment creation must return job_id")
        return job_id

    async def _poll_role_index_under_load(
        self, client: httpx.AsyncClient
    ) -> list[dict[str, Any]]:
        samples: list[dict[str, Any]] = []
        deadline = time.monotonic() + STREAM_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            for _ in range(ROLE_LOAD_BURST_SIZE):
                started_at = time.perf_counter()
                response = await client.get("/api/roles")
                elapsed_ms = (time.perf_counter() - started_at) * 1000
                response.raise_for_status()
                samples.append(
                    {
                        "name": "GET /api/roles under load",
                        "value_ms": round(elapsed_ms, 3),
                        "timestamp": time.time(),
                    }
                )
            await asyncio.sleep(5)
            if len(samples) >= 12 * ROLE_LOAD_BURST_SIZE:
                break
        return samples
