import os
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


class TestPrepareLocalRepoCacheScript(unittest.TestCase):
    def test_script_documents_required_dashboard_repo_cache(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        script_path = (
            repo_root / "scripts" / "e2e" / "dashboard" / "prepare-local-repo-cache.sh"
        )
        script_text = script_path.read_text(encoding="utf-8")

        self.assertIn("This is infrastructure", script_text)
        self.assertIn("optimization for reproducibility", script_text)
        self.assertIn("not a substitute for fixing", script_text)
        self.assertIn(
            "https://github.com/kevinveenbirkenbach/port-ui.git",
            script_text,
        )

    def test_required_remote_repo_is_mirrored_and_seeded(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        script_path = (
            repo_root / "scripts" / "e2e" / "dashboard" / "prepare-local-repo-cache.sh"
        )

        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            repo_root_dir = tmp_path / "repo-root"
            state_dir = tmp_path / "state"
            remote_root = tmp_path / "remotes" / "github.com" / "kevinveenbirkenbach"
            bare_repo = remote_root / "port-ui.git"
            work_repo = tmp_path / "work-repo"

            repo_root_dir.mkdir()
            state_dir.mkdir()
            remote_root.mkdir(parents=True)
            work_repo.mkdir()

            subprocess.run(
                ["git", "init", str(work_repo)],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            (work_repo / "README.md").write_text("port-ui\n", encoding="utf-8")
            subprocess.run(
                ["git", "-C", str(work_repo), "add", "README.md"],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(work_repo),
                    "-c",
                    "user.name=Test User",
                    "-c",
                    "user.email=test@example.com",
                    "commit",
                    "-m",
                    "init",
                ],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            subprocess.run(
                ["git", "init", "--bare", str(bare_repo)],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            subprocess.run(
                ["git", "-C", str(work_repo), "branch", "-M", "main"],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            subprocess.run(
                ["git", "-C", str(work_repo), "remote", "add", "origin", f"file://{bare_repo}"],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            subprocess.run(
                ["git", "-C", str(work_repo), "push", "-u", "origin", "main"],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(bare_repo),
                    "symbolic-ref",
                    "HEAD",
                    "refs/heads/main",
                ],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

            env = dict(os.environ)
            env["INFINITO_E2E_LOCAL_REPOS_DIR"] = str(tmp_path / "missing-local-repos")
            env["INFINITO_E2E_REQUIRED_REMOTE_REPOS"] = f"file://{bare_repo}"

            proc = subprocess.run(
                [
                    "bash",
                    str(script_path),
                    "--repo-root",
                    str(repo_root_dir),
                    "--state-dir",
                    str(state_dir),
                ],
                env=env,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(proc.returncode, 0, proc.stderr)
            output_lines = [line for line in proc.stdout.splitlines() if line]
            self.assertEqual(len(output_lines), 2, proc.stdout)
            mirror_root = Path(output_lines[0])
            seed_root = Path(output_lines[1])

            mirror_repo = (
                mirror_root / "github.com" / "kevinveenbirkenbach" / "port-ui.git"
            )
            seed_repo = seed_root / "github.com" / "kevinveenbirkenbach" / "port-ui"
            self.assertTrue(mirror_repo.is_dir())
            self.assertTrue((seed_repo / ".git").is_dir())
            self.assertEqual(
                (seed_repo / "README.md").read_text(encoding="utf-8"),
                "port-ui\n",
            )

            remote_url = subprocess.run(
                ["git", "-C", str(seed_repo), "remote", "get-url", "origin"],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            ).stdout.strip()
            self.assertEqual(
                remote_url,
                "file:///opt/e2e/repo-mirrors/github.com/kevinveenbirkenbach/port-ui.git",
            )
