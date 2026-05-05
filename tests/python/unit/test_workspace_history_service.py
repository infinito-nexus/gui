from __future__ import annotations

import os
import subprocess
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi import HTTPException

from services.workspaces import WorkspaceService


class TestWorkspaceHistoryService(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)

        self._old_state_dir = os.environ.get("STATE_DIR")
        self._old_history_enabled = os.environ.get("WORKSPACE_HISTORY_ENABLED")
        os.environ["STATE_DIR"] = self._tmp.name
        os.environ["WORKSPACE_HISTORY_ENABLED"] = "1"

    def tearDown(self) -> None:
        if self._old_state_dir is None:
            os.environ.pop("STATE_DIR", None)
        else:
            os.environ["STATE_DIR"] = self._old_state_dir

        if self._old_history_enabled is None:
            os.environ.pop("WORKSPACE_HISTORY_ENABLED", None)
        else:
            os.environ["WORKSPACE_HISTORY_ENABLED"] = self._old_history_enabled

    def _new_workspace(self) -> tuple[WorkspaceService, str]:
        service = WorkspaceService()
        created = service.create(owner_id="user-1")
        workspace_id = str(created["workspace_id"])
        return service, workspace_id

    def test_first_write_initializes_git_history(self) -> None:
        service, workspace_id = self._new_workspace()
        service.write_file(workspace_id, "group_vars/all.yml", "hello: world\n")

        root = service.ensure(workspace_id)
        self.assertTrue((root / ".git").is_dir())
        self.assertTrue((root / ".gitignore").is_file())
        gitignore = (root / ".gitignore").read_text(encoding="utf-8")
        self.assertEqual(gitignore.strip(), "")

        exclude = (root / ".git" / "info" / "exclude").read_text(encoding="utf-8")
        self.assertIn("workspace.json", exclude)
        self.assertIn("logs/", exclude)

        entries = service.list_files(workspace_id)
        paths = {str(item.get("path") or "") for item in entries}
        self.assertNotIn(".git", paths)

        history = service.list_history(workspace_id)
        self.assertGreaterEqual(len(history), 1)
        self.assertEqual(history[0]["summary"], "create: group_vars/all.yml")

    def test_invalid_sha_returns_404(self) -> None:
        service, workspace_id = self._new_workspace()
        service.write_file(workspace_id, "group_vars/all.yml", "value: 1\n")

        with self.assertRaises(HTTPException) as ctx:
            service.get_history_diff(workspace_id, "deadbeef")
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(str(ctx.exception.detail), "history commit not found")

    def test_history_is_isolated_between_workspaces(self) -> None:
        service = WorkspaceService()
        workspace_a = str(service.create(owner_id="user-a")["workspace_id"])
        workspace_b = str(service.create(owner_id="user-b")["workspace_id"])

        service.write_file(workspace_a, "group_vars/a.yml", "value: a\n")
        service.write_file(workspace_b, "group_vars/b.yml", "value: b\n")
        sha_a = service.list_history(workspace_a)[0]["sha"]

        with self.assertRaises(HTTPException) as ctx:
            service.get_history_commit(workspace_b, sha_a)
        self.assertEqual(ctx.exception.status_code, 404)

    def test_diff_masks_sensitive_values(self) -> None:
        service, workspace_id = self._new_workspace()
        raw_token = "abcDEF0123456789ghijKLMN"
        service.write_file(workspace_id, "group_vars/all.yml", f"value: {raw_token}\n")
        sha = service.list_history(workspace_id)[0]["sha"]

        diff = service.get_history_diff(workspace_id, sha)["diff"]
        self.assertNotIn(raw_token, diff)
        self.assertIn("********", diff)

    def test_plaintext_secret_is_rejected_before_commit(self) -> None:
        service, workspace_id = self._new_workspace()

        with self.assertRaises(HTTPException) as ctx:
            service.write_file(
                workspace_id,
                "group_vars/all.yml",
                "password: super-secret-value\n",
            )

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("plaintext secret detected", str(ctx.exception.detail))
        self.assertEqual(service.list_history(workspace_id), [])

    def test_restore_rejects_invalid_yaml_snapshot_without_corruption(self) -> None:
        service, workspace_id = self._new_workspace()
        path = "group_vars/all.yml"

        service.write_file(workspace_id, path, "version: 1\n")
        service.write_file(workspace_id, path, "version: [2\n")
        invalid_sha = service.list_history(workspace_id)[0]["sha"]
        service.write_file(workspace_id, path, "version: 3\n")

        with self.assertRaises(HTTPException) as ctx:
            service.restore_history_workspace(workspace_id, invalid_sha)

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(service.read_file(workspace_id, path), "version: 3\n")

    def test_restore_workspace_is_atomic_when_copy_fails(self) -> None:
        service, workspace_id = self._new_workspace()
        path = "group_vars/all.yml"

        service.write_file(workspace_id, path, "state: old\n")
        old_sha = service.list_history(workspace_id)[0]["sha"]
        service.write_file(workspace_id, path, "state: new\n")

        original_copy = service._copy_workspace_payload

        def flaky_copy(source, target):  # type: ignore[no-untyped-def]
            if source.name.startswith("workspace-restore-snapshot-"):
                raise RuntimeError("simulated copy failure")
            return original_copy(source, target)

        with patch.object(service, "_copy_workspace_payload", side_effect=flaky_copy):
            with self.assertRaises(HTTPException) as ctx:
                service.restore_history_workspace(workspace_id, old_sha)

        self.assertEqual(ctx.exception.status_code, 500)
        self.assertEqual(service.read_file(workspace_id, path), "state: new\n")

    def test_run_git_marks_workspace_as_safe_directory(self) -> None:
        service, workspace_id = self._new_workspace()
        root = service.ensure(workspace_id)

        with patch(
            "services.workspaces.mixins.history.main.subprocess.run"
        ) as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout="",
                stderr="",
            )

            service._run_git(root, ["status"], check=False)

        command = mock_run.call_args.args[0]
        self.assertEqual(command[:4], ["git", "-c", f"safe.directory={root}", "-C"])
        self.assertEqual(command[4], str(root))


if __name__ == "__main__":
    unittest.main()
