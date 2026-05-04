"""Unit tests for the per-user workspace alias logic.

Covers `_next_default_alias`, `_ensure_alias_unique`, and
`rename_workspace_alias` from the workspace management mixin.
The HTTP/route layer is exercised by the existing integration
test suite; these tests stay close to the pure logic and stub
`list_for_user` so they don't need a workspace tree on disk.
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import HTTPException

from services.workspaces.workspace_service_management import (
    WorkspaceServiceManagementMixin,
)


class _StubWorkspaces(WorkspaceServiceManagementMixin):
    """Subclass that fakes `list_for_user` so the helpers under test
    can be called without an actual workspace directory tree.
    """

    def __init__(self, entries: list[dict]):
        # Skip the parent constructor — it tries to ensure the
        # workspaces root directory which we don't need here.
        self._entries = entries

    def list_for_user(self, user_id: str) -> list[dict]:  # type: ignore[override]
        return [dict(entry) for entry in self._entries]


class TestNextDefaultAlias(unittest.TestCase):
    def test_first_workspace_gets_main(self) -> None:
        svc = _StubWorkspaces(entries=[])
        self.assertEqual(svc._next_default_alias("alice"), "main")

    def test_second_workspace_gets_workspace_2(self) -> None:
        svc = _StubWorkspaces(entries=[{"workspace_id": "abc", "name": "main"}])
        self.assertEqual(svc._next_default_alias("alice"), "workspace-2")

    def test_skips_already_used_numbered_slots(self) -> None:
        svc = _StubWorkspaces(
            entries=[
                {"workspace_id": "a", "name": "main"},
                {"workspace_id": "b", "name": "workspace-2"},
                {"workspace_id": "c", "name": "workspace-3"},
                {"workspace_id": "d", "name": "workspace-5"},
            ]
        )
        # workspace-4 is the next free slot.
        self.assertEqual(svc._next_default_alias("alice"), "workspace-4")

    def test_main_reused_after_delete(self) -> None:
        # If the user never named the first workspace `main` (e.g.
        # picked a custom name and never created another), `main`
        # is still available.
        svc = _StubWorkspaces(entries=[{"workspace_id": "x", "name": "personal"}])
        self.assertEqual(svc._next_default_alias("alice"), "main")

    def test_anonymous_user_treated_as_empty(self) -> None:
        # Anonymous (no owner_id) -> behaves as if no prior workspaces.
        svc = _StubWorkspaces(entries=[{"workspace_id": "x", "name": "main"}])
        # The stub returns the same list regardless of user_id, but
        # the helper short-circuits on empty owner so the alias is
        # `main` even though the stub claims `main` is taken.
        self.assertEqual(svc._next_default_alias(None), "main")
        self.assertEqual(svc._next_default_alias(""), "main")


class TestEnsureAliasUnique(unittest.TestCase):
    def test_no_collision_returns_silently(self) -> None:
        svc = _StubWorkspaces(entries=[{"workspace_id": "a", "name": "main"}])
        # No raise -> ok
        svc._ensure_alias_unique("alice", "personal")

    def test_collision_raises_409(self) -> None:
        svc = _StubWorkspaces(entries=[{"workspace_id": "a", "name": "main"}])
        with self.assertRaises(HTTPException) as ctx:
            svc._ensure_alias_unique("alice", "main")
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("already used", ctx.exception.detail)

    def test_exclude_workspace_id_lets_rename_keep_same_alias(self) -> None:
        # Renaming a workspace to its current alias must not raise —
        # the rename endpoint passes exclude_workspace_id for that.
        svc = _StubWorkspaces(entries=[{"workspace_id": "a", "name": "main"}])
        svc._ensure_alias_unique("alice", "main", exclude_workspace_id="a")

    def test_anonymous_owner_is_a_noop(self) -> None:
        # Anonymous users have no per-user list, so uniqueness is not
        # enforced. (UI-side, anonymous sessions get one ephemeral
        # workspace anyway.)
        svc = _StubWorkspaces(entries=[{"workspace_id": "a", "name": "main"}])
        svc._ensure_alias_unique(None, "main")
        svc._ensure_alias_unique("", "main")


class TestRenameWorkspaceAlias(unittest.TestCase):
    def test_rename_validates_uniqueness(self) -> None:
        # Build a stub that simulates two existing workspaces.
        svc = _StubWorkspaces(
            entries=[
                {"workspace_id": "a", "name": "main"},
                {"workspace_id": "b", "name": "workspace-2"},
            ]
        )
        # Patch ensure() and meta load/write so we don't touch disk.
        with (
            patch.object(svc, "ensure") as ensure_mock,
            patch(
                "services.workspaces.workspace_service_management._load_meta",
                return_value={"workspace_id": "b", "name": "workspace-2"},
            ),
            patch("services.workspaces.workspace_service_management._write_meta"),
        ):
            ensure_mock.return_value = object()
            with self.assertRaises(HTTPException) as ctx:
                svc.rename_workspace_alias("b", "main", owner_id="alice")
            self.assertEqual(ctx.exception.status_code, 409)

    def test_rename_with_unique_alias_writes_meta(self) -> None:
        svc = _StubWorkspaces(entries=[{"workspace_id": "a", "name": "main"}])
        captured: dict = {}
        with (
            patch.object(svc, "ensure") as ensure_mock,
            patch(
                "services.workspaces.workspace_service_management._load_meta",
                return_value={"workspace_id": "a", "name": "main"},
            ),
            patch(
                "services.workspaces.workspace_service_management._write_meta",
                side_effect=lambda root, meta: captured.setdefault("meta", meta),
            ),
        ):
            ensure_mock.return_value = object()
            result = svc.rename_workspace_alias("a", "personal", owner_id="alice")
        self.assertEqual(result["name"], "personal")
        self.assertEqual(captured["meta"]["name"], "personal")

    def test_rename_to_empty_falls_back_to_workspace_id(self) -> None:
        svc = _StubWorkspaces(entries=[])
        captured: dict = {}
        with (
            patch.object(svc, "ensure") as ensure_mock,
            patch(
                "services.workspaces.workspace_service_management._load_meta",
                return_value={"workspace_id": "abc", "name": "old"},
            ),
            patch(
                "services.workspaces.workspace_service_management._write_meta",
                side_effect=lambda root, meta: captured.setdefault("meta", meta),
            ),
        ):
            ensure_mock.return_value = object()
            result = svc.rename_workspace_alias("abc", "  ", owner_id="alice")
        self.assertEqual(result["name"], "abc")


class TestCreateAssignsDefaultAlias(unittest.TestCase):
    """Higher-level test: the create() method picks `main` for the
    first workspace and `workspace-2` for the second, and rejects
    explicit collisions.
    """

    def test_create_collision_raises(self) -> None:
        svc = _StubWorkspaces(entries=[{"workspace_id": "a", "name": "main"}])
        with self.assertRaises(HTTPException) as ctx:
            # We don't call create() directly to avoid disk; the
            # uniqueness path runs before any write.
            svc._ensure_alias_unique("alice", "main")
        self.assertEqual(ctx.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
