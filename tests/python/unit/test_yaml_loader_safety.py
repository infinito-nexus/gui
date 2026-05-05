from __future__ import annotations

import unittest
from pathlib import Path

from services.workspaces.mixins.context import load_workspace_yaml_document


class TestYamlLoaderSafety(unittest.TestCase):
    def test_workspace_yaml_loader_preserves_vault_tag_values(self) -> None:
        loaded = load_workspace_yaml_document(
            (
                "ansible_password: !vault |\n"
                "  $ANSIBLE_VAULT;1.1;AES256\n"
                "  deadbeefdeadbeefdeadbeefdeadbeef\n"
            )
        )

        self.assertIsInstance(loaded, dict)
        password = loaded["ansible_password"]
        self.assertEqual(getattr(password, "tag", None), "!vault")
        self.assertIn("$ANSIBLE_VAULT", str(getattr(password, "value", "")))

    def test_repo_sources_do_not_use_banned_yaml_load_calls(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        offenders: list[str] = []
        banned_pattern = "yaml." + "load("
        for path in sorted((repo_root / "apps").rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            if banned_pattern in text:
                offenders.append(path.relative_to(repo_root).as_posix())

        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
