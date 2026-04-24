import unittest
from pathlib import Path


class TestPrepareLocalImageCacheScript(unittest.TestCase):
    def test_required_base_images_are_cached_for_local_dashboard_builds(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        script_path = (
            repo_root / "scripts" / "e2e" / "dashboard" / "prepare-local-image-cache.sh"
        )
        script = script_path.read_text(encoding="utf-8")

        self.assertIn(
            '"python:3.12-slim@sha256:520153e2deb359602c9cffd84e491e3431d76e7bf95a3255c9ce9433b76ab99a"',
            script,
        )
        self.assertIn(
            '"node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293"',
            script,
        )
        self.assertIn(
            '"mariadb:latest|mariadb:11.4@sha256:3b4dfcc32247eb07adbebec0793afae2a8eafa6860ec523ee56af4d3dec42f7f|mariadb:11.4"',
            script,
        )
        self.assertIn("not a network fix", script)
