import os
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


class TestEnsureLocalRunnerImageScript(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[3]
        self.script_path = self.repo_root / "scripts" / "ensure-local-runner-image.sh"

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
            # ensure-local-runner-image.sh prefers process-env values over the
            # --env-file argument (`local value="${!key:-}"` short-circuits
            # before the awk fallback). Strip the relevant vars from the
            # subprocess env so the env_body driven by the test is the only
            # source of truth, otherwise CI workflows that set
            # JOB_RUNNER_IMAGE/INFINITO_NEXUS_IMAGE in their `env:` block
            # silently bypass the script logic and the assertions fire on an
            # empty docker.log.
            env.pop("JOB_RUNNER_IMAGE", None)
            env.pop("INFINITO_NEXUS_IMAGE", None)

            completed = subprocess.run(
                ["bash", str(self.script_path), str(env_file)],
                cwd=str(self.repo_root),
                text=True,
                capture_output=True,
                env=env,
                check=False,
            )
            log_text = (
                docker_log.read_text(encoding="utf-8") if docker_log.exists() else ""
            )
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

    def test_skips_pull_when_digest_pinned_runner_image_already_present(
        self,
    ) -> None:
        completed, log_text = self._run_script(
            env_body=(
                "JOB_RUNNER_IMAGE=ghcr.io/infinito-nexus/core/arch@sha256:"
                + ("a" * 64)
                + "\n"
            ),
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
        self.assertIn(
            "image inspect ghcr.io/infinito-nexus/core/arch@sha256:", log_text
        )
        self.assertNotIn("pull ghcr.io/infinito-nexus/core/arch", log_text)

    def test_pulls_digest_pinned_runner_image_when_absent(self) -> None:
        completed, log_text = self._run_script(
            env_body=(
                "JOB_RUNNER_IMAGE=ghcr.io/infinito-nexus/core/arch@sha256:"
                + ("a" * 64)
                + "\n"
            ),
            docker_script="""#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${DOCKER_LOG}"
if [[ "$1" == "image" && "$2" == "inspect" ]]; then
  exit 1
fi
exit 0
""",
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn(
            "image inspect ghcr.io/infinito-nexus/core/arch@sha256:", log_text
        )
        self.assertIn("pull ghcr.io/infinito-nexus/core/arch@sha256:", log_text)
