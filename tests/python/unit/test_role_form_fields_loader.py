"""Unit tests for the layered form_fields loader (req-023)."""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import yaml

from services.role_index.form_fields_loader import load_form_fields


class TestFormFieldsLoader(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.role_dir = Path(self._tmp.name) / "web-app-fixture"
        self.role_dir.mkdir()

    def _write_yaml(self, rel_path: str, payload) -> None:
        target = self.role_dir / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(yaml.safe_dump(payload), encoding="utf-8")

    def _by_path(self, fields):
        return {tuple(f.path): f for f in fields}

    # ---------- type inference ----------

    def test_infers_boolean_int_string_text(self) -> None:
        long_text = "x" * 200
        self._write_yaml(
            "config/main.yml",
            {
                "enabled": True,
                "retries": 3,
                "rate": 1.5,
                "name": "akaunting",
                "description": long_text,
            },
        )

        fields = self._by_path(load_form_fields(self.role_dir))

        self.assertEqual(fields[("enabled",)].type, "boolean")
        self.assertEqual(fields[("retries",)].type, "integer")
        self.assertEqual(fields[("rate",)].type, "float")
        self.assertEqual(fields[("name",)].type, "string")
        self.assertEqual(fields[("description",)].type, "text")

    def test_lists_and_mappings(self) -> None:
        self._write_yaml(
            "config/main.yml",
            {
                "tags": ["a", "b", "c"],
                "limits": {"max_users": 100, "max_uploads": 5},
            },
        )

        fields = self._by_path(load_form_fields(self.role_dir))

        # Lists become a single field; mappings unfold to leaves.
        self.assertEqual(fields[("tags",)].type, "list")
        self.assertEqual(fields[("limits", "max_users")].type, "integer")
        self.assertEqual(fields[("limits", "max_uploads")].type, "integer")

    def test_secret_field_names_become_password_type(self) -> None:
        self._write_yaml(
            "config/main.yml",
            {
                "admin_password": "x",
                "api_token": "x",
                "smtp_secret": "x",
                "api_key": "x",
                "harmless": "x",
            },
        )

        fields = self._by_path(load_form_fields(self.role_dir))

        for key in ("admin_password", "api_token", "smtp_secret", "api_key"):
            self.assertEqual(
                fields[(key,)].type, "password", f"{key} should be password type"
            )
            self.assertTrue(fields[(key,)].secret)
        self.assertFalse(fields[("harmless",)].secret)

    # ---------- new-layout: meta/schema.yml ----------

    def test_meta_schema_explicit_type_wins_over_inferred(self) -> None:
        self._write_yaml(
            "meta/schema.yml",
            {
                "settings": {
                    "retention_days": {
                        "type": "integer",
                        "default": 90,
                        "validation": "^[0-9]+$",
                    }
                }
            },
        )
        # Same key in config/main.yml as a string would normally yield
        # `string`; but schema.yml wins.
        self._write_yaml("config/main.yml", {"settings": {"retention_days": "90"}})

        fields = self._by_path(load_form_fields(self.role_dir))

        retention = fields[("settings", "retention_days")]
        self.assertEqual(retention.type, "integer")
        self.assertEqual(retention.validation, "^[0-9]+$")
        self.assertEqual(retention.default, 90)

    def test_meta_schema_credentials_block_marks_secret(self) -> None:
        # Mirrors the actual akaunting meta/schema.yml shape.
        self._write_yaml(
            "meta/schema.yml",
            {
                "credentials": {
                    "setup_admin_password": {
                        "description": "Initial admin password",
                        "algorithm": "sha256",
                        "validation": "^[a-f0-9]{64}$",
                    }
                }
            },
        )

        fields = self._by_path(load_form_fields(self.role_dir))
        leaf = fields[("credentials", "setup_admin_password")]
        self.assertTrue(leaf.secret)
        self.assertEqual(leaf.type, "password")
        self.assertEqual(leaf.description, "Initial admin password")
        self.assertEqual(leaf.validation, "^[a-f0-9]{64}$")

    # ---------- precedence ----------

    def test_all_three_sources_merge_with_schema_winning(self) -> None:
        self._write_yaml(
            "meta/schema.yml",
            {
                "rate": {
                    "type": "integer",
                    "default": 5,
                    "description": "rate",
                }
            },
        )
        self._write_yaml("meta/server.yml", {"rate": "ignored", "host": "default-host"})
        self._write_yaml(
            "config/main.yml",
            {"rate": "999", "host": "old-host", "extra": True},
        )

        fields = self._by_path(load_form_fields(self.role_dir))

        # rate: schema wins (type=integer, default=5)
        self.assertEqual(fields[("rate",)].type, "integer")
        self.assertEqual(fields[("rate",)].default, 5)

        # host: meta defaults win over config
        self.assertEqual(fields[("host",)].default, "default-host")

        # extra: only config has it -> still present
        self.assertEqual(fields[("extra",)].type, "boolean")
        self.assertTrue(fields[("extra",)].default)

    # ---------- exclusions ----------

    def test_features_and_services_blocks_excluded_from_form_fields(self) -> None:
        # features:/services: are surfaced via req-022's services_links;
        # they MUST NOT appear in form_fields.
        self._write_yaml(
            "config/main.yml",
            {
                "features": {"matomo": True},
                "services": {"redis": {"enabled": False}},
                "rate": 5,
            },
        )

        fields = self._by_path(load_form_fields(self.role_dir))
        self.assertIn(("rate",), fields)
        for path in fields:
            self.assertNotIn("features", path)
            self.assertNotIn("services", path)

    def test_app_config_blocks_excluded(self) -> None:
        # An entry carrying image/ports/run_after is the role's own
        # internal app-config; never user-tunable.
        self._write_yaml(
            "config/main.yml",
            {
                "akaunting": {
                    "image": "docker.io/x",
                    "ports": {"http": 80},
                    "run_after": ["web-app-mariadb"],
                },
                "rate": 5,
            },
        )

        fields = self._by_path(load_form_fields(self.role_dir))
        self.assertEqual(set(fields.keys()), {("rate",)})

    def test_galaxy_info_excluded_from_meta_main(self) -> None:
        self._write_yaml(
            "meta/main.yml",
            {
                "galaxy_info": {"author": "Kevin", "license": "X"},
                "tunable": True,
            },
        )

        fields = self._by_path(load_form_fields(self.role_dir))
        self.assertEqual(set(fields.keys()), {("tunable",)})

    def test_no_sources_yields_empty_list(self) -> None:
        self.assertEqual(load_form_fields(self.role_dir), [])

    def test_malformed_yaml_falls_through(self) -> None:
        (self.role_dir / "meta").mkdir()
        (self.role_dir / "meta" / "schema.yml").write_text(
            ":::\nnot valid yaml\n  -:", encoding="utf-8"
        )
        self._write_yaml("config/main.yml", {"rate": 5})

        fields = self._by_path(load_form_fields(self.role_dir))
        self.assertEqual(set(fields.keys()), {("rate",)})


if __name__ == "__main__":
    unittest.main()
