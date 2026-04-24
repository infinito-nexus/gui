import os
import unittest
from unittest.mock import patch

from pydantic import ValidationError

from api.schemas.runner_manager import RunnerManagerJobSpec


class TestRunnerManagerJobSpec(unittest.TestCase):
    JOB_ID = "123e4567-e89b-42d3-a456-426614174000"
    RUNNER_IMAGE = "ghcr.io/example/runner@sha256:" + ("a" * 64)

    def _payload(self):
        return {
            "job_id": self.JOB_ID,
            "workspace_id": "workspace-123",
            "runner_image": self.RUNNER_IMAGE,
            "inventory_path": "inventory.yml",
            "secrets_dir": "/tmp/runner-secrets",
            "role_ids": ["web-app-dashboard"],
            "network_name": f"job-{self.JOB_ID}",
            "labels": {
                "infinito.deployer.job_id": self.JOB_ID,
                "infinito.deployer.workspace_id": "workspace-123",
                "infinito.deployer.role": "job-runner",
            },
        }

    def test_model_rejects_undocumented_extra_fields(self) -> None:
        payload = self._payload()
        payload["extra_field"] = True
        with self.assertRaises(ValidationError):
            RunnerManagerJobSpec.model_validate(payload)

    def test_model_rejects_absolute_or_parent_paths(self) -> None:
        payload = self._payload()
        payload["inventory_path"] = "../inventory.yml"
        with self.assertRaises(ValidationError):
            RunnerManagerJobSpec.model_validate(payload)

    def test_model_requires_absolute_host_secrets_dir(self) -> None:
        payload = self._payload()
        payload["secrets_dir"] = "secrets"
        with self.assertRaises(ValidationError):
            RunnerManagerJobSpec.model_validate(payload)

    def test_model_requires_documented_labels(self) -> None:
        payload = self._payload()
        payload["labels"].pop("infinito.deployer.role")
        with self.assertRaises(ValidationError):
            RunnerManagerJobSpec.model_validate(payload)

    def test_model_rejects_non_uuid_job_ids(self) -> None:
        payload = self._payload()
        payload["job_id"] = "job-123"
        payload["labels"]["infinito.deployer.job_id"] = "job-123"
        payload["network_name"] = "job-job-123"
        with self.assertRaises(ValidationError):
            RunnerManagerJobSpec.model_validate(payload)

    def test_model_requires_network_name_to_match_job_id(self) -> None:
        payload = self._payload()
        payload["network_name"] = "job-123e4567-e89b-42d3-a456-426614174111"
        with self.assertRaises(ValidationError):
            RunnerManagerJobSpec.model_validate(payload)

    def test_model_allows_unpinned_runner_image_by_default_for_local_dev(self) -> None:
        payload = self._payload()
        payload["runner_image"] = "ghcr.io/example/runner:latest"
        with patch.dict(os.environ, {}, clear=True):
            spec = RunnerManagerJobSpec.model_validate(payload)

        self.assertEqual(spec.runner_image, "ghcr.io/example/runner:latest")

    def test_model_rejects_unpinned_runner_image_when_ci_digest_pinning_is_enabled(
        self,
    ) -> None:
        payload = self._payload()
        payload["runner_image"] = "ghcr.io/example/runner:latest"
        with patch.dict(os.environ, {"CI": "true"}, clear=True):
            with self.assertRaises(ValidationError):
                RunnerManagerJobSpec.model_validate(payload)

    def test_model_allows_unpinned_runner_image_in_local_source_mode(self) -> None:
        payload = self._payload()
        payload["runner_image"] = "ghcr.io/example/runner:latest"
        with patch.dict(
            os.environ,
            {
                "CI": "true",
                "INFINITO_NEXUS_SRC_DIR": "/tmp/infinito",
            },
            clear=True,
        ):
            spec = RunnerManagerJobSpec.model_validate(payload)

        self.assertEqual(spec.runner_image, "ghcr.io/example/runner:latest")

    def test_model_allows_unpinned_runner_image_when_digest_flag_is_explicitly_off(
        self,
    ) -> None:
        payload = self._payload()
        payload["runner_image"] = "ghcr.io/example/runner:latest"
        with patch.dict(
            os.environ,
            {
                "CI": "true",
                "INFINITO_ENFORCE_DIGEST_PINNING": "false",
            },
            clear=True,
        ):
            spec = RunnerManagerJobSpec.model_validate(payload)

        self.assertEqual(spec.runner_image, "ghcr.io/example/runner:latest")
