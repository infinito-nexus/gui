import os
import time
import json
import re
import shlex
import subprocess
import unittest
from tempfile import TemporaryDirectory
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import yaml

_UUID4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)

_PINNED_RUNNER_IMAGE = "ghcr.io/example/runner@sha256:" + ("a" * 64)

__all__ = [
    'os',
    'time',
    'json',
    're',
    'shlex',
    'subprocess',
    'unittest',
    'TemporaryDirectory',
    'Path',
    'SimpleNamespace',
    'MagicMock',
    'patch',
    'yaml',
    '_UUID4_RE',
    '_PINNED_RUNNER_IMAGE',
    'JobRunnerServiceTestCase',
]

class JobRunnerServiceTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)

        self._old_state_dir = os.environ.get("STATE_DIR")
        os.environ["STATE_DIR"] = self._tmp.name
        self._old_runner_cmd = os.environ.get("RUNNER_CMD")
        os.environ["RUNNER_CMD"] = "true"
        self.workspace_id = "abc123"
        workspace_root = Path(self._tmp.name) / "workspaces" / self.workspace_id
        workspace_root.mkdir(parents=True, exist_ok=True)
        (workspace_root / "inventory.yml").write_text(
            "all:\n  children:\n    example-role:\n      hosts:\n        localhost: {}\n",
            encoding="utf-8",
        )
        secrets_dir = workspace_root / "secrets"
        secrets_dir.mkdir(parents=True, exist_ok=True)
        playbooks_dir = workspace_root / "playbooks"
        playbooks_dir.mkdir(parents=True, exist_ok=True)
        (playbooks_dir / "emit_lines.yml").write_text(
            "- hosts: all\n"
            "  gather_facts: false\n"
            "  tasks:\n"
            "    - ansible.builtin.debug:\n"
            "        msg: perf\n",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        if self._old_state_dir is None:
            os.environ.pop("STATE_DIR", None)
        else:
            os.environ["STATE_DIR"] = self._old_state_dir
        if self._old_runner_cmd is None:
            os.environ.pop("RUNNER_CMD", None)
        else:
            os.environ["RUNNER_CMD"] = self._old_runner_cmd

    def _minimal_request(self):
        from api.schemas.deployment import DeploymentRequest  # noqa: WPS433

        # Adjust fields if your schema differs, but keep it valid.
        return DeploymentRequest(
            workspace_id=self.workspace_id,
            host="localhost",
            user="tester",
            auth={"method": "password", "password": "x"},
            selected_roles=["example-role"],
        )

    def _secret_request(self):
        from api.schemas.deployment import DeploymentRequest  # noqa: WPS433

        return DeploymentRequest(
            workspace_id=self.workspace_id,
            host="localhost",
            user="tester",
            auth={"method": "password", "password": "supersecret"},
            master_password="vault-master",
            selected_roles=["example-role"],
        )

    def _key_request(self):
        from api.schemas.deployment import DeploymentRequest  # noqa: WPS433

        return DeploymentRequest(
            workspace_id=self.workspace_id,
            host="localhost",
            user="tester",
            auth={"method": "private_key", "private_key": "KEYDATA"},
            selected_roles=["example-role"],
        )

    def _playbook_request(self):
        from api.schemas.deployment import DeploymentRequest  # noqa: WPS433

        return DeploymentRequest(
            workspace_id=self.workspace_id,
            host="localhost",
            user="tester",
            auth={"method": "password", "password": "x"},
            selected_roles=[],
            playbook_path="playbooks/emit_lines.yml",
        )

    def _wait_for_terminal(self, svc, job_id: str) -> None:
        for _ in range(200):
            cur = svc.get(job_id)
            if cur.status in {"succeeded", "failed", "canceled"}:
                return
            time.sleep(0.01)

        time.sleep(0.05)
