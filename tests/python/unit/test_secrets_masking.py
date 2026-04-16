import unittest

from api.schemas.deployment import DeploymentRequest
from services.job_runner.secrets import (
    MASK,
    collect_secrets,
    mask_mapping,
    mask_secrets,
)


class TestSecretsMasking(unittest.TestCase):
    def _password_request(self) -> DeploymentRequest:
        return DeploymentRequest(
            workspace_id="abc123",
            host="localhost",
            user="root",
            master_password="vault-master",
            auth={"method": "password", "password": "hunter2"},
            selected_roles=["base-role"],
        )

    def test_collect_secrets_from_auth(self) -> None:
        req = self._password_request()
        secrets = collect_secrets(req)

        self.assertIn("hunter2", secrets)
        self.assertIn("vault-master", secrets)

    def test_mask_secrets_replaces_values_and_patterns(self) -> None:
        text = "password=hunter2 token=tok-123 sshpass -p secret"
        masked = mask_secrets(text, secrets=["hunter2", "tok-123"])

        self.assertNotIn("hunter2", masked)
        self.assertNotIn("tok-123", masked)
        self.assertIn(MASK, masked)

        # Pattern-only masking should still work without explicit secrets
        masked_inline = mask_secrets("password=abc", secrets=[])
        self.assertEqual(masked_inline, "password=********")

    def test_private_key_block_is_masked(self) -> None:
        block = "-----BEGIN PRIVATE KEY-----\nABCDEF\n-----END PRIVATE KEY-----"
        masked = mask_secrets(block, secrets=[])
        self.assertEqual(masked, MASK)

    def test_mask_mapping_uses_key_regex_and_tokens(self) -> None:
        data = {
            "DB_PASSWORD": "db-pass",
            "API_SECRET": "secret-123",
            "token": "tok-abcdefghijklmnopqrstuvwxyz1234",
            "nested": {"safe": "hello"},
        }
        masked = mask_mapping(data, secrets=[])

        self.assertEqual(masked["DB_PASSWORD"], MASK)
        self.assertEqual(masked["API_SECRET"], MASK)
        self.assertEqual(masked["token"], MASK)
        self.assertEqual(masked["nested"]["safe"], "hello")
