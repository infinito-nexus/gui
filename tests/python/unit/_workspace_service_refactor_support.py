from __future__ import annotations
import os
import subprocess
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from fastapi import HTTPException
from services.workspaces import WorkspaceService

if __name__ == "__main__":
    unittest.main()

__all__ = [
    'annotations',
    'os',
    'subprocess',
    'threading',
    'unittest',
    'Path',
    'TemporaryDirectory',
    'patch',
    'HTTPException',
    'WorkspaceService',
    'WorkspaceServiceRefactorTestCase',
]

class WorkspaceServiceRefactorTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._old_state_dir = os.environ.get("STATE_DIR")
        self._old_repo_path = os.environ.get("INFINITO_REPO_PATH")
        os.environ["STATE_DIR"] = self._tmp.name
        os.environ["INFINITO_REPO_PATH"] = str(Path(__file__).resolve().parents[3])

    def tearDown(self) -> None:
        if self._old_state_dir is None:
            os.environ.pop("STATE_DIR", None)
        else:
            os.environ["STATE_DIR"] = self._old_state_dir
        if self._old_repo_path is None:
            os.environ.pop("INFINITO_REPO_PATH", None)
        else:
            os.environ["INFINITO_REPO_PATH"] = self._old_repo_path
