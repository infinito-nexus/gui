import unittest
from pathlib import Path
import re


class TestApiImageSupplyChain(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        cls.dockerfile_path = repo_root / "apps" / "api" / "Dockerfile"
        cls.lockfile_path = repo_root / "apps" / "api" / "requirements.lock"
        cls.requirements_path = repo_root / "apps" / "api" / "requirements.txt"
        cls.dockerfile = cls.dockerfile_path.read_text(encoding="utf-8")
        cls.lockfile = cls.lockfile_path.read_text(encoding="utf-8")
        cls.requirements = cls.requirements_path.read_text(encoding="utf-8")

    def test_api_image_uses_hash_locked_requirements(self) -> None:
        self.assertTrue(self.lockfile_path.is_file())
        self.assertIn("--hash=sha256:", self.lockfile)
        self.assertIn(
            "FROM python:3.12-slim@sha256:520153e2deb359602c9cffd84e491e3431d76e7bf95a3255c9ce9433b76ab99a",
            self.dockerfile,
        )
        self.assertIn("COPY requirements.lock /app/requirements.lock", self.dockerfile)
        # Per req 018 the pip install is preceded by an optional conditional
        # that points pip at the local cache when INFINITO_CACHE_PIP_INDEX_URL
        # is set. The hash-locked install command itself is unchanged.
        self.assertIn(
            "pip install --no-cache-dir --require-hashes -r /app/requirements.lock",
            self.dockerfile,
        )
        self.assertNotIn("-r /app/requirements.txt", self.dockerfile)

    def test_every_direct_requirement_is_locked(self) -> None:
        def normalize_name(raw: str) -> str:
            base = raw.split("[", 1)[0].strip().lower()
            return re.sub(r"[-_.]+", "-", base)

        locked_names = {
            normalize_name(line.split("==", 1)[0])
            for line in self.lockfile.splitlines()
            if "==" in line and not line.startswith("    ")
        }
        direct_names = {
            normalize_name(line.split("==", 1)[0].split(">=", 1)[0])
            for line in self.requirements.splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }

        self.assertTrue(direct_names)
        self.assertTrue(direct_names.issubset(locked_names))


if __name__ == "__main__":
    unittest.main()
