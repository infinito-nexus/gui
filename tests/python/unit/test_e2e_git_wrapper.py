import os
import shutil
import subprocess
import textwrap
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


class TestE2EGitWrapper(unittest.TestCase):
    @staticmethod
    def _install_wrapper(tmp_path: Path, invocation_name: str) -> Path:
        repo_root = Path(__file__).resolve().parents[3]
        source_wrapper = repo_root / "apps" / "test" / "ssh-password" / "git-wrapper.sh"
        installed_wrapper = tmp_path / invocation_name
        shutil.copyfile(source_wrapper, installed_wrapper)
        installed_wrapper.chmod(0o755)
        return installed_wrapper

    def test_ls_remote_uses_local_repo_mirror(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            wrapper_path = self._install_wrapper(tmp_path, "git")
            mirror_path = (
                tmp_path
                / "repo-mirrors"
                / "github.com"
                / "kevinveenbirkenbach"
                / "port-ui.git"
            )
            mirror_path.mkdir(parents=True)

            calls_path = tmp_path / "calls.log"
            fake_git = tmp_path / "git.actual"
            fake_git.write_text(
                textwrap.dedent(
                    f"""\
                    #!/usr/bin/env bash
                    set -euo pipefail
                    printf '%s\\n' "$*" >"{calls_path}"
                    """
                ),
                encoding="utf-8",
            )
            fake_git.chmod(0o755)

            env = dict(os.environ)
            env["INFINITO_E2E_REAL_GIT"] = str(fake_git)
            env["INFINITO_E2E_REPO_MIRROR_ROOT"] = str(tmp_path / "repo-mirrors")

            proc = subprocess.run(
                [
                    str(wrapper_path),
                    "ls-remote",
                    "https://github.com/kevinveenbirkenbach/port-ui",
                    "-h",
                    "refs/heads/main",
                ],
                cwd=tmp,
                env=env,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(proc.returncode, 0, proc.stderr)
            calls = calls_path.read_text(encoding="utf-8")
            self.assertIn(f"file://{mirror_path}", calls)
            self.assertNotIn(
                "https://github.com/kevinveenbirkenbach/port-ui",
                calls,
            )

    def test_unknown_remote_passes_through(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            wrapper_path = self._install_wrapper(tmp_path, "git")
            calls_path = tmp_path / "calls.log"
            fake_git = tmp_path / "git.actual"
            fake_git.write_text(
                textwrap.dedent(
                    f"""\
                    #!/usr/bin/env bash
                    set -euo pipefail
                    printf '%s\\n' "$*" >"{calls_path}"
                    """
                ),
                encoding="utf-8",
            )
            fake_git.chmod(0o755)

            env = dict(os.environ)
            env["INFINITO_E2E_REAL_GIT"] = str(fake_git)
            env["INFINITO_E2E_REPO_MIRROR_ROOT"] = str(tmp_path / "repo-mirrors")

            remote = "https://github.com/example/unknown-repo"
            proc = subprocess.run(
                ["bash", str(wrapper_path), "ls-remote", remote],
                cwd=tmp,
                env=env,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn(remote, calls_path.read_text(encoding="utf-8"))

    def test_clone_removes_invalid_partial_destination_before_retry(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            wrapper_path = self._install_wrapper(tmp_path, "git")
            dest_path = tmp_path / "repository"
            git_dir = dest_path / ".git"
            git_dir.mkdir(parents=True)
            (git_dir / "HEAD").write_text(
                "ref: refs/heads/.invalid\n", encoding="utf-8"
            )

            calls_path = tmp_path / "calls.log"
            fake_git = tmp_path / "git.actual"
            fake_git.write_text(
                textwrap.dedent(
                    f"""\
                    #!/usr/bin/env bash
                    set -euo pipefail
                    printf '%s\\n' "$*" >"{calls_path}"
                    """
                ),
                encoding="utf-8",
            )
            fake_git.chmod(0o755)

            env = dict(os.environ)
            env["INFINITO_E2E_REAL_GIT"] = str(fake_git)
            env["INFINITO_E2E_REPO_MIRROR_ROOT"] = str(tmp_path / "repo-mirrors")

            proc = subprocess.run(
                [
                    str(wrapper_path),
                    "clone",
                    "--depth",
                    "1",
                    "https://github.com/kevinveenbirkenbach/port-ui",
                    str(dest_path),
                ],
                cwd=tmp,
                env=env,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertFalse(dest_path.exists())
            calls = calls_path.read_text(encoding="utf-8")
            self.assertIn("clone --depth 1", calls)
            self.assertIn(str(dest_path), calls)

    def test_git_helper_invocation_preserves_argv0_and_repo_path(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            helper_path = self._install_wrapper(tmp_path, "git-upload-pack")
            bare_repo = tmp_path / "repo.git"
            subprocess.run(
                ["git", "init", "--bare", str(bare_repo)],
                cwd=tmp,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            )

            env = dict(os.environ)
            env["INFINITO_E2E_REAL_GIT"] = shutil.which("git") or "git"
            env["INFINITO_E2E_REPO_MIRROR_ROOT"] = str(tmp_path / "repo-mirrors")

            proc = subprocess.run(
                [
                    str(helper_path),
                    "--stateless-rpc",
                    "--advertise-refs",
                    str(bare_repo),
                ],
                cwd=tmp,
                env=env,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertTrue(proc.stdout)
