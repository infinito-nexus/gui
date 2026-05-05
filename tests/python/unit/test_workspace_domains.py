"""Unit tests for the workspace domains mixin (status transitions)."""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import yaml
from fastapi import HTTPException

from services.workspaces.workspace_service_domains import (
    DOMAIN_CATALOG_KEY,
    WorkspaceServiceDomainsMixin,
)


class _StubDomains(WorkspaceServiceDomainsMixin):
    def __init__(self, root: Path) -> None:
        self._root = root

    def ensure(self, workspace_id: str) -> Path:  # type: ignore[override]
        return self._root

    def workspace_write_lock(self, workspace_id: str):  # type: ignore[override]
        from contextlib import nullcontext

        return nullcontext()


class TestListAndTransition(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.workspace_root = Path(self._tmp.name) / "workspace-1"
        self.workspace_root.mkdir()
        (self.workspace_root / "group_vars").mkdir()
        self.svc = _StubDomains(self.workspace_root)

    def _write_catalog(self, entries: list) -> None:
        all_yml = self.workspace_root / "group_vars" / "all.yml"
        all_yml.write_text(
            yaml.safe_dump({DOMAIN_CATALOG_KEY: entries}, sort_keys=False),
            encoding="utf-8",
        )

    def test_list_domains_treats_legacy_entries_as_active(self) -> None:
        self._write_catalog(
            [
                {"type": "fqdn", "domain": "shop.example.org"},
                "legacy.example.com",
            ]
        )
        out = self.svc.list_domains("workspace-1")
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0]["status"], "active")
        self.assertEqual(out[1]["status"], "active")
        self.assertEqual(out[0]["type"], "fqdn")
        self.assertEqual(out[1]["domain"], "legacy.example.com")

    def test_list_domains_normalizes_unknown_status(self) -> None:
        self._write_catalog(
            [{"type": "fqdn", "domain": "x.example.org", "status": "weird"}]
        )
        out = self.svc.list_domains("workspace-1")
        self.assertEqual(out[0]["status"], "active")

    def test_transition_reserved_to_ordered_attaches_order_id(self) -> None:
        self._write_catalog(
            [{"type": "fqdn", "domain": "shop.example.org", "status": "reserved"}]
        )
        result = self.svc.transition_domain_status(
            "workspace-1", "shop.example.org", "ordered", order_id="order-uuid-1"
        )
        self.assertEqual(result["status"], "ordered")
        self.assertEqual(result["order_id"], "order-uuid-1")
        # Persisted on disk too
        loaded = yaml.safe_load(
            (self.workspace_root / "group_vars" / "all.yml").read_text("utf-8")
        )
        entry = loaded[DOMAIN_CATALOG_KEY][0]
        self.assertEqual(entry["status"], "ordered")
        self.assertEqual(entry["order_id"], "order-uuid-1")
        self.assertTrue(entry["status_changed_at"])

    def test_transition_ordered_to_active_drops_order_id(self) -> None:
        self._write_catalog(
            [
                {
                    "type": "fqdn",
                    "domain": "shop.example.org",
                    "status": "ordered",
                    "order_id": "order-uuid-1",
                }
            ]
        )
        result = self.svc.transition_domain_status(
            "workspace-1", "shop.example.org", "active"
        )
        self.assertEqual(result["status"], "active")
        self.assertIsNone(result["order_id"])
        loaded = yaml.safe_load(
            (self.workspace_root / "group_vars" / "all.yml").read_text("utf-8")
        )
        self.assertNotIn("order_id", loaded[DOMAIN_CATALOG_KEY][0])

    def test_invalid_transition_rejected(self) -> None:
        self._write_catalog(
            [{"type": "fqdn", "domain": "shop.example.org", "status": "active"}]
        )
        with self.assertRaises(HTTPException) as ctx:
            self.svc.transition_domain_status(
                "workspace-1", "shop.example.org", "reserved"
            )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_disabled_to_active_and_back(self) -> None:
        self._write_catalog(
            [{"type": "fqdn", "domain": "shop.example.org", "status": "active"}]
        )
        self.svc.transition_domain_status("workspace-1", "shop.example.org", "disabled")
        out = self.svc.list_domains("workspace-1")
        self.assertEqual(out[0]["status"], "disabled")
        self.svc.transition_domain_status("workspace-1", "shop.example.org", "active")
        out = self.svc.list_domains("workspace-1")
        self.assertEqual(out[0]["status"], "active")

    def test_failed_can_retry_to_ordered(self) -> None:
        self._write_catalog(
            [{"type": "fqdn", "domain": "shop.example.org", "status": "failed"}]
        )
        self.svc.transition_domain_status(
            "workspace-1", "shop.example.org", "ordered", order_id="order-2"
        )
        out = self.svc.list_domains("workspace-1")
        self.assertEqual(out[0]["status"], "ordered")
        self.assertEqual(out[0]["order_id"], "order-2")

    def test_ordered_can_be_cancelled(self) -> None:
        self._write_catalog(
            [
                {
                    "type": "fqdn",
                    "domain": "shop.example.org",
                    "status": "ordered",
                    "order_id": "order-3",
                }
            ]
        )
        self.svc.transition_domain_status(
            "workspace-1", "shop.example.org", "cancelled"
        )
        out = self.svc.list_domains("workspace-1")
        self.assertEqual(out[0]["status"], "cancelled")

    def test_cancelled_is_terminal(self) -> None:
        self._write_catalog(
            [{"type": "fqdn", "domain": "shop.example.org", "status": "cancelled"}]
        )
        with self.assertRaises(HTTPException) as ctx:
            self.svc.transition_domain_status(
                "workspace-1", "shop.example.org", "ordered"
            )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_failed_can_be_cancelled(self) -> None:
        self._write_catalog(
            [{"type": "fqdn", "domain": "shop.example.org", "status": "failed"}]
        )
        self.svc.transition_domain_status(
            "workspace-1", "shop.example.org", "cancelled"
        )
        out = self.svc.list_domains("workspace-1")
        self.assertEqual(out[0]["status"], "cancelled")

    def test_unknown_domain_returns_404(self) -> None:
        self._write_catalog([])
        with self.assertRaises(HTTPException) as ctx:
            self.svc.transition_domain_status(
                "workspace-1", "missing.example.org", "ordered"
            )
        self.assertEqual(ctx.exception.status_code, 404)

    def test_unknown_status_returns_400(self) -> None:
        self._write_catalog(
            [{"type": "fqdn", "domain": "shop.example.org", "status": "active"}]
        )
        with self.assertRaises(HTTPException) as ctx:
            self.svc.transition_domain_status(
                "workspace-1", "shop.example.org", "weird"
            )
        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
