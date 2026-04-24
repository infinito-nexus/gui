import os
import subprocess
import textwrap
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


class TestE2EDockerWrapper(unittest.TestCase):
    def test_compose_build_uses_cached_images_and_legacy_builder(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        wrapper_path = (
            repo_root / "apps" / "test" / "ssh-password" / "docker-wrapper.sh"
        )

        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            cache_dir = tmp_path / "image-cache"
            cache_dir.mkdir()
            (cache_dir / "images.tsv").write_text(
                "python:3.12-slim\tpython_3_12_slim.tar\n",
                encoding="utf-8",
            )
            (cache_dir / "python_3_12_slim.tar").write_text(
                "fake image tar",
                encoding="utf-8",
            )

            compose_file = tmp_path / "compose.yml"
            compose_file.write_text("services:\n  demo: {}\n", encoding="utf-8")

            calls_path = tmp_path / "calls.log"
            fake_docker = tmp_path / "docker.actual"
            fake_docker.write_text(
                textwrap.dedent(
                    f"""\
                    #!/usr/bin/env bash
                    set -euo pipefail

                    calls_path="{calls_path}"

                    if [ "${{1:-}}" = "compose" ] && [ "${{2:-}}" = "-f" ] && [ "${{4:-}}" = "config" ]; then
                      cat <<'EOF'
                    services:
                      demo:
                        image: dashboard_custom
                        build:
                          context: .
                    EOF
                      exit 0
                    fi

                    if [ "${{1:-}}" = "image" ] && [ "${{2:-}}" = "inspect" ]; then
                      exit 1
                    fi

                    if [ "${{1:-}}" = "load" ] && [ "${{2:-}}" = "-i" ]; then
                      printf 'load %s\\n' "${{3:-}}" >>"${{calls_path}}"
                      exit 0
                    fi

                    if [ "${{1:-}}" = "compose" ] && [ "${{2:-}}" = "-f" ] && [ "${{4:-}}" = "build" ]; then
                      printf 'build %s %s %s %s %s\\n' "${{DOCKER_BUILDKIT:-unset}}" "${{COMPOSE_DOCKER_CLI_BUILD:-unset}}" "${{1:-}}" "${{2:-}}" "${{3:-}}" >>"${{calls_path}}"
                      exit 0
                    fi

                    printf 'unexpected %s\\n' "$*" >>"${{calls_path}}"
                    exit 1
                    """
                ),
                encoding="utf-8",
            )
            fake_docker.chmod(0o755)

            env = dict(os.environ)
            env["INFINITO_E2E_REAL_DOCKER"] = str(fake_docker)
            env["INFINITO_E2E_IMAGE_CACHE_DIR"] = str(cache_dir)

            proc = subprocess.run(
                [
                    "bash",
                    str(wrapper_path),
                    "compose",
                    "-f",
                    str(compose_file),
                    "build",
                    "--pull",
                ],
                cwd=tmp,
                env=env,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn(
                "preloading optional hermetic image cache",
                proc.stderr,
            )
            self.assertIn(
                "forcing DOCKER_BUILDKIT=0",
                proc.stderr,
            )

            calls = calls_path.read_text(encoding="utf-8")
            self.assertIn("load", calls)
            self.assertIn("build 0 0 compose -f", calls)
            self.assertNotIn("--pull", calls)

    def test_pull_retags_cached_alias_to_requested_image_ref(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        wrapper_path = (
            repo_root / "apps" / "test" / "ssh-password" / "docker-wrapper.sh"
        )

        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            cache_dir = tmp_path / "image-cache"
            cache_dir.mkdir()
            (cache_dir / "images.tsv").write_text(
                "mariadb:latest\tmariadb_11_4_sha.tar\tmariadb:11.4\n",
                encoding="utf-8",
            )
            (cache_dir / "mariadb_11_4_sha.tar").write_text(
                "fake image tar",
                encoding="utf-8",
            )

            calls_path = tmp_path / "calls.log"
            state_path = tmp_path / "state"
            fake_docker = tmp_path / "docker.actual"
            fake_docker.write_text(
                textwrap.dedent(
                    f"""\
                    #!/usr/bin/env bash
                    set -euo pipefail

                    calls_path="{calls_path}"
                    state_path="{state_path}"

                    if [ "${{1:-}}" = "image" ] && [ "${{2:-}}" = "inspect" ]; then
                      case "${{3:-}}" in
                        mariadb:11.4)
                          [ -f "${{state_path}}.loaded" ] && exit 0
                          exit 1
                          ;;
                        mariadb:latest)
                          [ -f "${{state_path}}.tagged" ] && exit 0
                          exit 1
                          ;;
                      esac
                    fi

                    if [ "${{1:-}}" = "load" ] && [ "${{2:-}}" = "-i" ]; then
                      printf 'load %s\\n' "${{3:-}}" >>"${{calls_path}}"
                      : >"${{state_path}}.loaded"
                      exit 0
                    fi

                    if [ "${{1:-}}" = "tag" ] && [ "${{2:-}}" = "mariadb:11.4" ] && [ "${{3:-}}" = "mariadb:latest" ]; then
                      printf 'tag %s %s\\n' "${{2:-}}" "${{3:-}}" >>"${{calls_path}}"
                      : >"${{state_path}}.tagged"
                      exit 0
                    fi

                    printf 'unexpected %s\\n' "$*" >>"${{calls_path}}"
                    exit 1
                    """
                ),
                encoding="utf-8",
            )
            fake_docker.chmod(0o755)

            env = dict(os.environ)
            env["INFINITO_E2E_REAL_DOCKER"] = str(fake_docker)
            env["INFINITO_E2E_IMAGE_CACHE_DIR"] = str(cache_dir)

            proc = subprocess.run(
                [
                    "bash",
                    str(wrapper_path),
                    "pull",
                    "mariadb:latest",
                ],
                cwd=tmp,
                env=env,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn(
                "using optional hermetic image cache instead of docker pull",
                proc.stderr,
            )

            calls = calls_path.read_text(encoding="utf-8")
            self.assertIn("load", calls)
            self.assertIn("tag mariadb:11.4 mariadb:latest", calls)
