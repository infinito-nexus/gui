import unittest
from pathlib import Path


class TestArchSshRunnerImage(unittest.TestCase):
    def test_local_runner_image_includes_yaml_runtime_dependencies(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        dockerfile = (
            repo_root / "apps" / "test" / "arch-ssh" / "Dockerfile"
        ).read_text(encoding="utf-8")

        self.assertIn("ansible-core", dockerfile)
        self.assertIn("python-pip", dockerfile)
        self.assertIn("python-yaml", dockerfile)
