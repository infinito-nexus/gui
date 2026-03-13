from __future__ import annotations

import io
import os
import unittest
import zipfile
from tempfile import TemporaryDirectory

import yaml

from services.workspaces import WorkspaceService


class TestWorkspaceZipImportModes(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._old_state_dir = os.environ.get("STATE_DIR")
        self._old_history_enabled = os.environ.get("WORKSPACE_HISTORY_ENABLED")
        os.environ["STATE_DIR"] = self._tmp.name
        os.environ["WORKSPACE_HISTORY_ENABLED"] = "0"

    def tearDown(self) -> None:
        if self._old_state_dir is None:
            os.environ.pop("STATE_DIR", None)
        else:
            os.environ["STATE_DIR"] = self._old_state_dir
        if self._old_history_enabled is None:
            os.environ.pop("WORKSPACE_HISTORY_ENABLED", None)
        else:
            os.environ["WORKSPACE_HISTORY_ENABLED"] = self._old_history_enabled

    def _zip_bytes(self, entries: dict[str, str]) -> bytes:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path, content in entries.items():
                archive.writestr(path, content)
        return buffer.getvalue()

    def test_list_zip_entries_filters_invalid_members(self) -> None:
        service = WorkspaceService()
        data = self._zip_bytes(
            {
                "inventory.yml": "all:\n  children: {}\n",
                "host_vars/test.yml": "ansible_host: test\n",
                "workspace.json": "{}\n",
                "../evil.txt": "no\n",
                "/abs.txt": "no\n",
                "C:/win.txt": "no\n",
            }
        )
        self.assertEqual(
            service.list_zip_entries(data),
            ["host_vars/test.yml", "inventory.yml"],
        )

    def test_load_zip_override_replaces_existing_file(self) -> None:
        service = WorkspaceService()
        workspace_id = str(service.create(owner_id="user-1")["workspace_id"])
        service.write_file(workspace_id, "group_vars/all.yml", "value: old\n")

        summary = service.load_zip(
            workspace_id,
            self._zip_bytes({"group_vars/all.yml": "value: new\n"}),
            default_mode="override",
        )

        self.assertEqual(
            service.read_file(workspace_id, "group_vars/all.yml"), "value: new\n"
        )
        self.assertEqual(summary["overridden_files"], 1)
        self.assertEqual(summary["merged_files"], 0)
        self.assertEqual(summary["skipped_files"], 0)

    def test_load_zip_merge_yaml_mappings(self) -> None:
        service = WorkspaceService()
        workspace_id = str(service.create(owner_id="user-1")["workspace_id"])
        service.write_file(
            workspace_id,
            "group_vars/all.yml",
            "a: 1\nnested:\n  keep: true\n  shared: old\n",
        )

        summary = service.load_zip(
            workspace_id,
            self._zip_bytes(
                {
                    "group_vars/all.yml": (
                        "b: 2\nnested:\n  shared: new\n  added: true\n"
                    )
                }
            ),
            default_mode="merge",
        )

        merged = yaml.safe_load(service.read_file(workspace_id, "group_vars/all.yml"))
        self.assertEqual(merged["a"], 1)
        self.assertEqual(merged["b"], 2)
        self.assertEqual(merged["nested"]["keep"], True)
        self.assertEqual(merged["nested"]["shared"], "new")
        self.assertEqual(merged["nested"]["added"], True)
        self.assertEqual(summary["merged_files"], 1)
        self.assertEqual(summary["skipped_files"], 0)

    def test_load_zip_merge_skips_non_structured_existing_file(self) -> None:
        service = WorkspaceService()
        workspace_id = str(service.create(owner_id="user-1")["workspace_id"])
        service.write_file(workspace_id, "notes.txt", "old text\n")

        summary = service.load_zip(
            workspace_id,
            self._zip_bytes({"notes.txt": "new text\n"}),
            default_mode="merge",
        )

        self.assertEqual(service.read_file(workspace_id, "notes.txt"), "old text\n")
        self.assertEqual(summary["merged_files"], 0)
        self.assertEqual(summary["skipped_files"], 1)


if __name__ == "__main__":
    unittest.main()
