import os
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


class TestEnsureLocalRunnerImageScript(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[3]
        self.script_path = (
            self.repo_root / "scripts" / "ensure-local-runner-image.sh"
        )

    def _run_script(
        self,
        *,
        env_body: str,
        docker_script: str,
    ) -> tuple[subprocess.CompletedProcess[str], str]:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            env_file = tmp_path / "test.env"
            env_file.write_text(env_body, encoding="utf-8")
            docker_log = tmp_path / "docker.log"
            docker_path = tmp_path / "docker"
            docker_path.write_text(docker_script, encoding="utf-8")
            docker_path.chmod(0o755)

            env = dict(os.environ)
            env["PATH"] = f"{tmp_path}:{env.get('PATH', '')}"
            env["DOCKER_LOG"] = str(docker_log)

            completed = subprocess.run(
                ["bash", str(self.script_path), str(env_file)],
                cwd=str(self.repo_root),
                text=True,
                capture_output=True,
                env=env,
                check=False,
            )
            log_text = docker_log.read_text(encoding="utf-8") if docker_log.exists() else ""
            return completed, log_text

    def test_rebuilds_repo_managed_infinito_arch_local_runner_image(self) -> None:
        completed, log_text = self._run_script(
            env_body="JOB_RUNNER_IMAGE=infinito-arch\n",
            docker_script="""#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${DOCKER_LOG}"
exit 0
""",
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("build -t infinito-arch", log_text)
        self.assertIn("apps/test/arch-ssh", log_text)

    def test_skips_build_for_existing_custom_local_runner_image(self) -> None:
        completed, log_text = self._run_script(
            env_body="JOB_RUNNER_IMAGE=custom-runner\n",
            docker_script="""#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${DOCKER_LOG}"
if [[ "$1" == "image" && "$2" == "inspect" ]]; then
  exit 0
fi
exit 0
""",
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("image inspect custom-runner", log_text)
        self.assertNotIn("build -t custom-runner", log_text)

    def test_ignores_digest_pinned_runner_images(self) -> None:
        completed, log_text = self._run_script(
            env_body=(
                "JOB_RUNNER_IMAGE=ghcr.io/infinito-nexus/core/arch@sha256:"
                + ("a" * 64)
                + "\n"
            ),
            docker_script="""#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${DOCKER_LOG}"
exit 0
""",
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(log_text, "")
