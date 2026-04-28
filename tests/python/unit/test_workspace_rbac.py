"""Unit tests for req 019 — workspace RBAC (owner + member memberships).

Covers:
- Owner can list / invite / remove / transfer.
- Member can read but cannot manage memberships.
- Pending invite is claim-on-access when X-Auth-Request-Email matches.
- Cross-user access without invite returns 404.
- list_for_user includes claimed memberships, NOT pending invites.
"""
from __future__ import annotations

import importlib
import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient


class TestWorkspaceRBAC(unittest.TestCase):
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
    def _hdr(user: str, email: str | None = None) -> dict[str, str]:
        h = {"X-Auth-Request-User": user}
        if email:
            h["X-Auth-Request-Email"] = email
        return h

    def _create(self, client: TestClient, user: str, email: str) -> str:
        r = client.post("/api/workspaces", headers=self._hdr(user, email))
        self.assertEqual(r.status_code, 200, r.text)
        return str(r.json()["workspace_id"])

    # ---------- members listing ----------------------------------------

    def test_owner_can_list_members_starts_empty(self) -> None:
        c = self._client()
        ws = self._create(c, "alice", "alice@example.com")

        r = c.get(
            f"/api/workspaces/{ws}/members",
            headers=self._hdr("alice", "alice@example.com"),
        )
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["owner"]["user_id"], "alice")
        self.assertEqual(body["owner"]["email"], "alice@example.com")
        self.assertEqual(body["members"], [])
        self.assertEqual(body["pending"], [])

    def test_non_member_cannot_list_members(self) -> None:
        c = self._client()
        ws = self._create(c, "alice", "alice@example.com")

        r = c.get(
            f"/api/workspaces/{ws}/members",
            headers=self._hdr("eve", "eve@example.com"),
        )
        self.assertEqual(r.status_code, 404)

    # ---------- invite + claim flow -----------------------------------

    def test_owner_invite_creates_pending(self) -> None:
        c = self._client()
        ws = self._create(c, "alice", "alice@example.com")

        r = c.post(
            f"/api/workspaces/{ws}/members",
            json={"email": "bob@example.com"},
            headers=self._hdr("alice", "alice@example.com"),
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIsNone(r.json().get("user_id"))
        self.assertEqual(r.json()["email"], "bob@example.com")

        r2 = c.get(
            f"/api/workspaces/{ws}/members",
            headers=self._hdr("alice", "alice@example.com"),
        )
        self.assertEqual(r2.json()["pending"][0]["email"], "bob@example.com")

    def test_member_cannot_invite(self) -> None:
        c = self._client()
        ws = self._create(c, "alice", "alice@example.com")
        c.post(
            f"/api/workspaces/{ws}/members",
            json={"email": "bob@example.com"},
            headers=self._hdr("alice", "alice@example.com"),
        )
        # bob claims by accessing
        c.get(
            f"/api/workspaces/{ws}/members",
            headers=self._hdr("bob", "bob@example.com"),
        )
        # bob (now a member) tries to invite
        r = c.post(
            f"/api/workspaces/{ws}/members",
            json={"email": "carol@example.com"},
            headers=self._hdr("bob", "bob@example.com"),
        )
        self.assertEqual(r.status_code, 403)

    def test_pending_invite_claims_on_access_by_email(self) -> None:
        c = self._client()
        ws = self._create(c, "alice", "alice@example.com")
        c.post(
            f"/api/workspaces/{ws}/members",
            json={"email": "bob@example.com"},
            headers=self._hdr("alice", "alice@example.com"),
        )

        # Bob accesses — claim should fire silently.
        r = c.get(
            f"/api/workspaces/{ws}/files",
            headers=self._hdr("bob", "bob@example.com"),
        )
        self.assertEqual(r.status_code, 200, r.text)

        # Member list now shows bob as claimed (not pending).
        r2 = c.get(
            f"/api/workspaces/{ws}/members",
            headers=self._hdr("alice", "alice@example.com"),
        )
        body = r2.json()
        self.assertEqual(len(body["members"]), 1)
        self.assertEqual(body["members"][0]["user_id"], "bob")
        self.assertEqual(body["pending"], [])

    def test_email_mismatch_does_not_claim(self) -> None:
        c = self._client()
        ws = self._create(c, "alice", "alice@example.com")
        c.post(
            f"/api/workspaces/{ws}/members",
            json={"email": "bob@example.com"},
            headers=self._hdr("alice", "alice@example.com"),
        )
        # Eve has a different email — must be denied.
        r = c.get(
            f"/api/workspaces/{ws}/files",
            headers=self._hdr("eve", "eve@example.com"),
        )
        self.assertEqual(r.status_code, 404)

    # ---------- list_for_user ----------------------------------------

    def test_list_for_user_includes_claimed_only(self) -> None:
        c = self._client()
        ws = self._create(c, "alice", "alice@example.com")
        # Pending invite — should NOT show in bob's list.
        c.post(
            f"/api/workspaces/{ws}/members",
            json={"email": "bob@example.com"},
            headers=self._hdr("alice", "alice@example.com"),
        )
        r1 = c.get("/api/workspaces", headers=self._hdr("bob", "bob@example.com"))
        self.assertEqual([w["workspace_id"] for w in r1.json()["workspaces"]], [])

        # Bob accesses → claim fires.
        c.get(
            f"/api/workspaces/{ws}/files",
            headers=self._hdr("bob", "bob@example.com"),
        )
        r2 = c.get("/api/workspaces", headers=self._hdr("bob", "bob@example.com"))
        out = r2.json()["workspaces"]
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["workspace_id"], ws)
        self.assertEqual(out[0]["role"], "member")

    # ---------- remove ----------------------------------------------

    def test_owner_can_remove_pending_by_email(self) -> None:
        c = self._client()
        ws = self._create(c, "alice", "alice@example.com")
        c.post(
            f"/api/workspaces/{ws}/members",
            json={"email": "bob@example.com"},
            headers=self._hdr("alice", "alice@example.com"),
        )
        r = c.delete(
            f"/api/workspaces/{ws}/members/bob@example.com",
            headers=self._hdr("alice", "alice@example.com"),
        )
        self.assertEqual(r.status_code, 200, r.text)

    def test_owner_can_remove_claimed_by_user_id(self) -> None:
        c = self._client()
        ws = self._create(c, "alice", "alice@example.com")
        c.post(
            f"/api/workspaces/{ws}/members",
            json={"email": "bob@example.com"},
            headers=self._hdr("alice", "alice@example.com"),
        )
        c.get(
            f"/api/workspaces/{ws}/files",
            headers=self._hdr("bob", "bob@example.com"),
        )
        r = c.delete(
            f"/api/workspaces/{ws}/members/bob",
            headers=self._hdr("alice", "alice@example.com"),
        )
        self.assertEqual(r.status_code, 200, r.text)
        # bob's next access is now denied.
        r2 = c.get(
            f"/api/workspaces/{ws}/files",
            headers=self._hdr("bob", "bob@example.com"),
        )
        self.assertEqual(r2.status_code, 404)

    def test_owner_cannot_remove_self_via_remove_member(self) -> None:
        c = self._client()
        ws = self._create(c, "alice", "alice@example.com")
        r = c.delete(
            f"/api/workspaces/{ws}/members/alice",
            headers=self._hdr("alice", "alice@example.com"),
        )
        self.assertEqual(r.status_code, 400)

    # ---------- transfer ownership -----------------------------------

    def test_transfer_ownership_swaps_owner_and_member(self) -> None:
        c = self._client()
        ws = self._create(c, "alice", "alice@example.com")
        c.post(
            f"/api/workspaces/{ws}/members",
            json={"email": "bob@example.com"},
            headers=self._hdr("alice", "alice@example.com"),
        )
        c.get(
            f"/api/workspaces/{ws}/files",
            headers=self._hdr("bob", "bob@example.com"),
        )

        r = c.post(
            f"/api/workspaces/{ws}/members/transfer-ownership",
            json={"new_owner_id": "bob"},
            headers=self._hdr("alice", "alice@example.com"),
        )
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["new_owner_id"], "bob")
        self.assertEqual(body["previous_owner_id"], "alice")

        # Now bob is owner, alice is a claimed member.
        r2 = c.get(
            f"/api/workspaces/{ws}/members",
            headers=self._hdr("bob", "bob@example.com"),
        )
        body2 = r2.json()
        self.assertEqual(body2["owner"]["user_id"], "bob")
        member_ids = [m["user_id"] for m in body2["members"]]
        self.assertIn("alice", member_ids)

    def test_transfer_to_non_member_rejected(self) -> None:
        c = self._client()
        ws = self._create(c, "alice", "alice@example.com")
        r = c.post(
            f"/api/workspaces/{ws}/members/transfer-ownership",
            json={"new_owner_id": "stranger"},
            headers=self._hdr("alice", "alice@example.com"),
        )
        self.assertEqual(r.status_code, 400)

    # ---------- backward compatibility -------------------------------

    def test_workspace_without_members_key_loads(self) -> None:
        """Workspaces created before req 019 lack `members`; must load."""
        c = self._client()
        ws = self._create(c, "alice", "alice@example.com")

        meta_path = Path(self._tmp.name) / "workspaces" / ws / "workspace.json"
        meta = json.loads(meta_path.read_text())
        meta.pop("members", None)
        meta_path.write_text(json.dumps(meta))

        r = c.get(
            f"/api/workspaces/{ws}/members",
            headers=self._hdr("alice", "alice@example.com"),
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["members"], [])
        self.assertEqual(r.json()["pending"], [])


if __name__ == "__main__":
    unittest.main()
