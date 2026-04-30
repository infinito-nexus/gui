"""Unit tests for the per-field path-based PATCH helpers (req-023).

Targets the pure helpers `_set_path` and `_delete_path` which carry
all the YAML-path logic; the integration with the workspace
write-lock and history commit is covered by the existing
test_workspace_service_refactor_part1 patterns.
"""

from __future__ import annotations

import unittest

from services.workspaces.workspace_service_inventory_role_apps import (
    _delete_path,
    _set_path,
)


class TestSetPath(unittest.TestCase):
    def test_set_top_level(self) -> None:
        target: dict = {}
        _set_path(target, ["rate"], 5)
        self.assertEqual(target, {"rate": 5})

    def test_set_nested_creates_missing_dicts(self) -> None:
        target: dict = {}
        _set_path(target, ["company", "name"], "Acme")
        self.assertEqual(target, {"company": {"name": "Acme"}})

    def test_set_overwrites_scalar(self) -> None:
        target = {"rate": 1}
        _set_path(target, ["rate"], 99)
        self.assertEqual(target["rate"], 99)

    def test_set_nested_overwrites_non_mapping_parent(self) -> None:
        # If a non-mapping sits where we need a parent dict, it gets
        # replaced — the form is the source of truth at write time.
        target = {"company": "string-not-mapping"}
        _set_path(target, ["company", "name"], "Acme")
        self.assertEqual(target, {"company": {"name": "Acme"}})

    def test_set_value_can_be_complex(self) -> None:
        target: dict = {}
        _set_path(target, ["limits"], {"max": 5, "min": 1})
        self.assertEqual(target["limits"], {"max": 5, "min": 1})


class TestDeletePath(unittest.TestCase):
    def test_delete_top_level(self) -> None:
        target = {"rate": 5, "name": "x"}
        _delete_path(target, ["rate"])
        self.assertEqual(target, {"name": "x"})

    def test_delete_nested_leaf(self) -> None:
        target = {"company": {"name": "Acme", "rate": 5}}
        _delete_path(target, ["company", "name"])
        self.assertEqual(target, {"company": {"rate": 5}})

    def test_delete_prunes_empty_parent(self) -> None:
        target = {"company": {"name": "Acme"}}
        _delete_path(target, ["company", "name"])
        # `company:` is now empty -> pruned
        self.assertEqual(target, {})

    def test_delete_prunes_multiple_levels(self) -> None:
        target = {"a": {"b": {"c": {"d": 1}}}}
        _delete_path(target, ["a", "b", "c", "d"])
        self.assertEqual(target, {})

    def test_delete_stops_at_non_empty_sibling(self) -> None:
        target = {"a": {"b": {"c": 1, "d": 2}}}
        _delete_path(target, ["a", "b", "c"])
        # `a.b.d` keeps the parent alive
        self.assertEqual(target, {"a": {"b": {"d": 2}}})

    def test_delete_missing_key_is_noop(self) -> None:
        target = {"rate": 5}
        _delete_path(target, ["nonexistent"])
        self.assertEqual(target, {"rate": 5})

    def test_delete_path_through_non_mapping_is_noop(self) -> None:
        target = {"a": "not-a-mapping"}
        _delete_path(target, ["a", "b"])
        self.assertEqual(target, {"a": "not-a-mapping"})


if __name__ == "__main__":
    unittest.main()
