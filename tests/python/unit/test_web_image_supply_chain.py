import unittest
import json
from pathlib import Path


class TestWebImageSupplyChain(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        cls.repo_root = repo_root
        cls.package_json = json.loads(
            (repo_root / "apps" / "web" / "package.json").read_text(encoding="utf-8")
        )

    def test_web_image_uses_npm_ci_with_committed_lockfile(self) -> None:
        dockerfile_path = self.repo_root / "apps" / "web" / "Dockerfile"
        lockfile_path = self.repo_root / "apps" / "web" / "package-lock.json"

        dockerfile = dockerfile_path.read_text(encoding="utf-8")

        self.assertTrue(lockfile_path.is_file())
        self.assertIn(
            "FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS deps",
            dockerfile,
        )
        self.assertIn("COPY package.json package-lock.json* /app/", dockerfile)
        # Per req 018 the npm ci step is preceded by an optional conditional
        # that points npm at the local cache when INFINITO_CACHE_NPM_REGISTRY
        # is set. The lockfile-pinned install itself is unchanged.
        self.assertIn("npm ci", dockerfile)
        self.assertIn("USER 10005:10005", dockerfile)

    def test_web_manifest_pins_hardened_frontend_dependencies(self) -> None:
        scripts = self.package_json["scripts"]
        dependencies = self.package_json["dependencies"]
        dev_dependencies = self.package_json["devDependencies"]
        overrides = self.package_json["overrides"]

        self.assertEqual(scripts["dev"], "next dev --webpack -p 3000 -H 0.0.0.0")
        self.assertEqual(scripts["build"], "next build --webpack")
        self.assertEqual(dependencies["next"], "16.2.4")
        self.assertEqual(dependencies["kdbxweb"], "2.1.1")
        self.assertEqual(dependencies["yaml"], "2.8.3")
        self.assertNotIn("react-quill", dependencies)
        self.assertEqual(dev_dependencies["@playwright/test"], "1.55.1")
        self.assertEqual(dev_dependencies["eslint"], "9.39.1")
        self.assertEqual(dev_dependencies["eslint-config-next"], "16.2.4")
        self.assertEqual(overrides["@xmldom/xmldom"], "0.9.10")
        self.assertEqual(overrides["brace-expansion@1.1.12"], "1.1.13")
        self.assertEqual(overrides["picomatch@4.0.3"], "4.0.4")

    def test_workspace_markdown_editor_no_longer_depends_on_quill(self) -> None:
        layout_path = self.repo_root / "apps" / "web" / "app" / "layout.tsx"
        editor_path = (
            self.repo_root
            / "apps"
            / "web"
            / "app"
            / "components"
            / "workspace-panel"
            / "WorkspacePanelFileEditor.tsx"
        )

        layout_source = layout_path.read_text(encoding="utf-8")
        editor_source = editor_path.read_text(encoding="utf-8")

        self.assertNotIn("react-quill", layout_source)
        self.assertNotIn("quill.snow.css", layout_source)
        self.assertNotIn("react-quill", editor_source)
        self.assertIn("<CodeMirror", editor_source)


if __name__ == "__main__":
    unittest.main()
