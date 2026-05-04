import unittest
from pathlib import Path

import yaml


class TestCiImagePinning(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        # CI tier-restructure splits the old monolithic tests.yml into
        # several reusable workflows. Real-stack jobs (perf, dashboard)
        # live under e2e.yml; the integration tier owns the
        # docker-compose-bound Python tests.
        cls.e2e_workflow = yaml.safe_load(
            (repo_root / ".github" / "workflows" / "e2e.yml").read_text(
                encoding="utf-8"
            )
        )
        cls.compose = yaml.safe_load(
            (repo_root / "docker-compose.yml").read_text(encoding="utf-8")
        )
        cls.e2e_script = (
            repo_root / "scripts" / "e2e" / "dashboard" / "run.sh"
        ).read_text(encoding="utf-8")
        cls.makefile = (repo_root / "Makefile").read_text(encoding="utf-8")

    def test_perf_job_pins_images_by_digest(self) -> None:
        env = self.e2e_workflow["jobs"]["perf"]["env"]
        self.assertRegex(env["INFINITO_NEXUS_IMAGE"], r"@sha256:[0-9a-f]{64}$")
        self.assertRegex(env["JOB_RUNNER_IMAGE"], r"@sha256:[0-9a-f]{64}$")
        self.assertRegex(env["POSTGRES_IMAGE"], r"@sha256:[0-9a-f]{64}$")
        self.assertEqual(env["INFINITO_ENFORCE_DIGEST_PINNING"], "true")

    def test_dashboard_e2e_job_pins_images_by_digest(self) -> None:
        env = self.e2e_workflow["jobs"]["dashboard-deploy"]["env"]
        self.assertRegex(env["INFINITO_E2E_CATALOG_IMAGE"], r"@sha256:[0-9a-f]{64}$")
        self.assertRegex(env["INFINITO_E2E_JOB_RUNNER_IMAGE"], r"@sha256:[0-9a-f]{64}$")
        self.assertRegex(env["INFINITO_E2E_POSTGRES_IMAGE"], r"@sha256:[0-9a-f]{64}$")

    def test_compose_accepts_ci_postgres_digest_and_api_digest_enforcement(
        self,
    ) -> None:
        db_service = self.compose["services"]["db"]
        api_env = self.compose["services"]["api"]["environment"]

        self.assertEqual(db_service["image"], "${POSTGRES_IMAGE:-postgres:16-alpine}")
        self.assertEqual(
            api_env["INFINITO_ENFORCE_DIGEST_PINNING"],
            "${INFINITO_ENFORCE_DIGEST_PINNING:-}",
        )

    def test_local_make_targets_emit_unpinned_warning(self) -> None:
        self.assertIn(
            "WARN: unpinned local image $$image, digest pinning enforced only in CI/prod",
            self.makefile,
        )
        self.assertIn("warn-local-unpinned-images", self.makefile)
        self.assertIn(
            "TEST_UP_SERVICES ?= api db catalog runner-manager web",
            self.makefile,
        )
        self.assertIn("grep -qx runner-manager", self.makefile)
        self.assertIn("export DOCKER_SOCKET_GID ?=", self.makefile)

    def test_e2e_script_uses_digest_pinned_ci_defaults(self) -> None:
        self.assertIn("CI_CATALOG_IMAGE_DEFAULT=", self.e2e_script)
        self.assertIn("CI_RUNNER_IMAGE_DEFAULT=", self.e2e_script)
        self.assertIn("CI_POSTGRES_IMAGE_DEFAULT=", self.e2e_script)
        self.assertIn('local enforce_digest_pinning="true"', self.e2e_script)
        self.assertIn('enforce_digest_pinning="false"', self.e2e_script)
        self.assertIn(
            "INFINITO_ENFORCE_DIGEST_PINNING=${enforce_digest_pinning}",
            self.e2e_script,
        )
        self.assertIn(
            "WARN: unpinned local image ${image_ref}, digest pinning enforced only in CI/prod",
            self.e2e_script,
        )


if __name__ == "__main__":
    unittest.main()
