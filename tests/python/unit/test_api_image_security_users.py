import unittest
from pathlib import Path


class TestApiImageSecurityUsers(unittest.TestCase):
    def test_api_image_declares_manager_group_and_service_users(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        dockerfile = (repo_root / "apps" / "api" / "Dockerfile").read_text(
            encoding="utf-8"
        )

        self.assertIn(
            "FROM python:3.12-slim@sha256:520153e2deb359602c9cffd84e491e3431d76e7bf95a3255c9ce9433b76ab99a",
            dockerfile,
        )
        self.assertIn("groupadd -g 10900 infinito-manager", dockerfile)
        self.assertIn("useradd -u 10001", dockerfile)
        self.assertIn("useradd -u 10003", dockerfile)
        self.assertIn("-G infinito-manager", dockerfile)
