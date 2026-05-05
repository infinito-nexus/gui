"""Route-level tests for the domain status transition endpoint.

Verifies that the backend itself enforces admin-only transitions —
the frontend filtering is defense-in-depth, but a non-admin client
must not be able to call the API directly to mark a domain active or
failed.
"""

from __future__ import annotations

import importlib
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import yaml
from fastapi.testclient import TestClient


class _DomainRouteCase(unittest.TestCase):
    """Shared TestClient setup with proxy-mode auth + admin headers."""

    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._saved_env = {
            key: os.environ.get(key)
            for key in (
                "ALLOWED_ORIGINS",
                "AUTH_PROXY_ENABLED",
                "AUTH_PROXY_USER_HEADER",
                "AUTH_PROXY_EMAIL_HEADER",
                "AUTH_PROXY_GROUPS_HEADER",
                "AUTH_DEV_ADMIN",
                "CORS_ALLOW_ORIGINS",
                "STATE_DIR",
            )
        }
        os.environ["STATE_DIR"] = self._tmp.name
        os.environ["ALLOWED_ORIGINS"] = "http://127.0.0.1:3000"
        os.environ["CORS_ALLOW_ORIGINS"] = ""
        os.environ["AUTH_PROXY_ENABLED"] = "true"
        os.environ["AUTH_PROXY_USER_HEADER"] = "X-Auth-Request-User"
        os.environ["AUTH_PROXY_EMAIL_HEADER"] = "X-Auth-Request-Email"
        os.environ["AUTH_PROXY_GROUPS_HEADER"] = "X-Auth-Request-Groups"
        os.environ.pop("AUTH_DEV_ADMIN", None)

    def tearDown(self) -> None:
        for key, value in self._saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def _client(self) -> TestClient:
        main_module = importlib.import_module("main")
        return TestClient(main_module.create_app())

    @staticmethod
    def _csrf(client: TestClient) -> dict[str, str]:
        client.get("/health")
        cookie = client.cookies.get("csrf") or ""
        return {"Cookie": f"csrf={cookie}", "X-CSRF": cookie}

    @staticmethod
    def _hdr(user: str, groups: str | None = None) -> dict[str, str]:
        h = {
            "X-Auth-Request-User": user,
            "X-Auth-Request-Email": f"{user}@example.com",
        }
        if groups is not None:
            h["X-Auth-Request-Groups"] = groups
        return h

    def _create_workspace(self, client: TestClient, user: str) -> str:
        h = {**self._hdr(user), **self._csrf(client)}
        r = client.post("/api/workspaces", headers=h)
        self.assertEqual(r.status_code, 200, r.text)
        return str(r.json()["workspace_id"])

    def _seed_domain(self, workspace_id: str, status: str) -> None:
        # Pre-populate group_vars/all.yml with one ordered domain so
        # the transition route has something to mutate.
        all_yml = (
            Path(self._tmp.name)
            / "workspaces"
            / workspace_id
            / "group_vars"
            / "all.yml"
        )
        all_yml.parent.mkdir(parents=True, exist_ok=True)
        all_yml.write_text(
            yaml.safe_dump(
                {
                    "INFINITO_DOMAINS": [
                        {
                            "type": "fqdn",
                            "domain": "shop.example.org",
                            "status": status,
                        }
                    ]
                },
                sort_keys=False,
            ),
            encoding="utf-8",
        )


class TestDomainAdminGate(_DomainRouteCase):
    def _post_status(
        self,
        client: TestClient,
        workspace_id: str,
        domain: str,
        next_status: str,
        *,
        groups: str | None = None,
    ):
        return client.post(
            f"/api/workspaces/{workspace_id}/domains/{domain}/status",
            headers={
                **self._hdr("alice", groups=groups),
                **self._csrf(client),
                "Content-Type": "application/json",
            },
            json={"status": next_status},
        )

    def test_non_admin_cannot_mark_active(self) -> None:
        c = self._client()
        ws = self._create_workspace(c, "alice")
        self._seed_domain(ws, "ordered")
        r = self._post_status(c, ws, "shop.example.org", "active", groups="billing")
        self.assertEqual(r.status_code, 403, r.text)

    def test_non_admin_cannot_mark_failed(self) -> None:
        c = self._client()
        ws = self._create_workspace(c, "alice")
        self._seed_domain(ws, "ordered")
        r = self._post_status(c, ws, "shop.example.org", "failed", groups="billing")
        self.assertEqual(r.status_code, 403, r.text)

    def test_admin_can_mark_active(self) -> None:
        c = self._client()
        ws = self._create_workspace(c, "alice")
        self._seed_domain(ws, "ordered")
        r = self._post_status(
            c, ws, "shop.example.org", "active", groups="administrator"
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["status"], "active")

    def test_non_admin_can_cancel(self) -> None:
        # Cancel is the customer's own escape hatch — must work for
        # non-admins so they can withdraw their own order.
        c = self._client()
        ws = self._create_workspace(c, "alice")
        self._seed_domain(ws, "ordered")
        r = self._post_status(c, ws, "shop.example.org", "cancelled", groups="billing")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["status"], "cancelled")

    def test_anonymous_without_groups_cannot_mark_active(self) -> None:
        c = self._client()
        ws = self._create_workspace(c, "alice")
        self._seed_domain(ws, "ordered")
        r = self._post_status(c, ws, "shop.example.org", "active")
        self.assertEqual(r.status_code, 403, r.text)


if __name__ == "__main__":
    unittest.main()
