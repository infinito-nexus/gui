"""Unit tests for the workspace orders mixin (place_order +
auto-create-user-from-contact)."""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import yaml
from fastapi import HTTPException

from services.workspaces.workspace_service_orders import (
    WorkspaceServiceOrdersMixin,
    _slugify_username,
    _split_full_name,
)


class _StubOrders(WorkspaceServiceOrdersMixin):
    """Wires the mixin against a real on-disk workspace tree but
    bypasses the real ensure() / lock plumbing.
    """

    def __init__(self, root: Path):
        self._root = root

    def ensure(self, workspace_id: str) -> Path:  # type: ignore[override]
        return self._root

    def workspace_write_lock(self, workspace_id: str):  # type: ignore[override]
        from contextlib import nullcontext

        return nullcontext()


class TestSlugify(unittest.TestCase):
    def test_email_local_part(self):
        self.assertEqual(_slugify_username("Alice.Smith@example.com"), "alicesmith")

    def test_full_name_collapse(self):
        self.assertEqual(_slugify_username("Bob O'Hara"), "bobohara")

    def test_empty(self):
        self.assertEqual(_slugify_username(""), "")
        self.assertEqual(_slugify_username("   "), "")


class TestSplitFullName(unittest.TestCase):
    def test_first_only(self):
        self.assertEqual(_split_full_name("Alice"), ("Alice", ""))

    def test_first_last(self):
        self.assertEqual(_split_full_name("Alice Smith"), ("Alice", "Smith"))

    def test_multipart(self):
        self.assertEqual(_split_full_name("Alice von Bergen"), ("Alice", "von Bergen"))


class TestPlaceOrder(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.workspace_root = Path(self._tmp.name) / "workspace-1"
        self.workspace_root.mkdir()
        (self.workspace_root / "group_vars").mkdir()
        self.svc = _StubOrders(self.workspace_root)

    def _payload(self, **overrides):
        base = {
            "full_name": "Alice Smith",
            "email": "alice@example.com",
            "company": "Acme Inc",
            "billing_cycle": "monthly",
            "payment_method": "invoice",
            "items": [{"alias": "device1", "role_id": "web-app-akaunting"}],
            "terms_accepted": True,
        }
        base.update(overrides)
        return base

    def test_anonymous_order_creates_workspace_user(self) -> None:
        with (
            patch(
                "services.workspaces.workspace_service_orders._load_meta",
                return_value={},
            ),
            patch("services.workspaces.workspace_service_orders._write_meta"),
        ):
            result = self.svc.place_order(
                "workspace-1",
                self._payload(),
                owner_id=None,
                owner_email=None,
            )

        self.assertIn("order_id", result)
        self.assertEqual(result["workspace_username"], "alice")
        self.assertIsNone(result["owner_user_id"])

        # Order file was written.
        orders_dir = self.workspace_root / "orders"
        files = list(orders_dir.glob("*.yml"))
        self.assertEqual(len(files), 1)
        record = yaml.safe_load(files[0].read_text(encoding="utf-8"))
        self.assertEqual(record["contact"]["full_name"], "Alice Smith")
        self.assertEqual(record["contact"]["email"], "alice@example.com")
        self.assertEqual(record["billing"]["cycle"], "monthly")
        self.assertEqual(record["items"][0]["role_id"], "web-app-akaunting")

        # Workspace user was added to group_vars/all.yml.
        all_yml = yaml.safe_load(
            (self.workspace_root / "group_vars" / "all.yml").read_text(encoding="utf-8")
        )
        self.assertIn("alice", all_yml["users"])
        self.assertEqual(all_yml["users"]["alice"]["firstname"], "Alice")
        self.assertEqual(all_yml["users"]["alice"]["lastname"], "Smith")

    def test_authenticated_order_skips_user_creation(self) -> None:
        with (
            patch(
                "services.workspaces.workspace_service_orders._load_meta",
                return_value={},
            ),
            patch("services.workspaces.workspace_service_orders._write_meta"),
        ):
            result = self.svc.place_order(
                "workspace-1",
                self._payload(),
                owner_id="kevin",
                owner_email="kevin@platform",
            )

        self.assertEqual(result["owner_user_id"], "kevin")
        self.assertIsNone(result["workspace_username"])
        # group_vars/all.yml should NOT have been created.
        self.assertFalse((self.workspace_root / "group_vars" / "all.yml").is_file())

    def test_order_without_items_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            self.svc.place_order(
                "workspace-1",
                self._payload(items=[]),
                owner_id=None,
                owner_email=None,
            )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_order_without_email_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            self.svc.place_order(
                "workspace-1",
                self._payload(email=""),
                owner_id=None,
                owner_email=None,
            )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_repeated_anonymous_order_reuses_existing_user(self) -> None:
        # Pre-populate group_vars/all.yml with a manually-edited user
        # so we can confirm the order flow doesn't clobber it.
        all_yml = self.workspace_root / "group_vars" / "all.yml"
        all_yml.write_text(
            yaml.safe_dump(
                {"users": {"alice": {"username": "alice", "firstname": "Edited"}}}
            ),
            encoding="utf-8",
        )

        with (
            patch(
                "services.workspaces.workspace_service_orders._load_meta",
                return_value={},
            ),
            patch("services.workspaces.workspace_service_orders._write_meta"),
        ):
            self.svc.place_order(
                "workspace-1",
                self._payload(),
                owner_id=None,
                owner_email=None,
            )

        loaded = yaml.safe_load(all_yml.read_text(encoding="utf-8"))
        # Pre-existing field is preserved untouched.
        self.assertEqual(loaded["users"]["alice"]["firstname"], "Edited")


class TestListOrders(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.workspace_root = Path(self._tmp.name) / "workspace-1"
        self.workspace_root.mkdir()
        (self.workspace_root / "group_vars").mkdir()
        self.svc = _StubOrders(self.workspace_root)

    def test_empty_returns_empty(self) -> None:
        self.assertEqual(self.svc.list_orders("workspace-1"), [])

    def test_lists_newest_first(self) -> None:
        with (
            patch(
                "services.workspaces.workspace_service_orders._load_meta",
                return_value={},
            ),
            patch("services.workspaces.workspace_service_orders._write_meta"),
        ):
            r1 = self.svc.place_order(
                "workspace-1",
                {
                    "full_name": "A",
                    "email": "a@x",
                    "items": [{"alias": "d", "role_id": "r"}],
                },
                owner_id=None,
                owner_email=None,
            )
            # Force a different created_at by patching _now_iso for
            # the second call.
            with patch(
                "services.workspaces.workspace_service_orders._now_iso",
                return_value="9999-01-01T00:00:00Z",
            ):
                r2 = self.svc.place_order(
                    "workspace-1",
                    {
                        "full_name": "B",
                        "email": "b@x",
                        "items": [{"alias": "d", "role_id": "r"}],
                    },
                    owner_id=None,
                    owner_email=None,
                )

        listed = self.svc.list_orders("workspace-1")
        self.assertEqual(len(listed), 2)
        # Newest first
        self.assertEqual(listed[0]["order_id"], r2["order_id"])
        self.assertEqual(listed[1]["order_id"], r1["order_id"])


if __name__ == "__main__":
    unittest.main()
