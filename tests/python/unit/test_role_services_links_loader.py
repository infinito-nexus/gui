"""Unit tests for the layered services_links loader (req-022)."""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import yaml

from services.role_index.service_links_loader import load_service_links


class TestServiceLinksLoader(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.role_dir = Path(self._tmp.name) / "web-app-fixture"
        self.role_dir.mkdir()

    def _write_meta_services(self, payload) -> None:
        (self.role_dir / "meta").mkdir(exist_ok=True)
        (self.role_dir / "meta" / "services.yml").write_text(
            yaml.safe_dump(payload), encoding="utf-8"
        )

    def _write_config_main(self, payload) -> None:
        (self.role_dir / "config").mkdir(exist_ok=True)
        (self.role_dir / "config" / "main.yml").write_text(
            yaml.safe_dump(payload), encoding="utf-8"
        )

    # ---------- new layout: meta/services.yml ----------

    def test_meta_services_extracts_toggles_and_skips_app_config(self) -> None:
        self._write_meta_services(
            {
                "matomo": {"enabled": True, "shared": True},
                "redis": {"enabled": False},
                "akaunting": {
                    "image": "docker.io/x",
                    "ports": {"http": 8080},
                    "run_after": ["a"],
                },
            }
        )

        links = load_service_links(self.role_dir)

        keys = {link.key for link in links}
        self.assertEqual(keys, {"matomo", "redis"})
        matomo = next(link for link in links if link.key == "matomo")
        self.assertTrue(matomo.default_enabled)
        self.assertTrue(matomo.shared)
        redis = next(link for link in links if link.key == "redis")
        self.assertFalse(redis.default_enabled)
        self.assertFalse(redis.shared)

    def test_meta_services_skips_entry_without_enabled(self) -> None:
        self._write_meta_services({"matomo": {"shared": True}})
        links = load_service_links(self.role_dir)
        self.assertEqual(links, [])

    # ---------- old layout: config/main.yml ----------

    def test_config_main_features_only(self) -> None:
        self._write_config_main({"features": {"matomo": True, "redis": False}})

        links = load_service_links(self.role_dir)

        self.assertEqual({link.key for link in links}, {"matomo", "redis"})

    def test_config_main_services_block_with_mappings(self) -> None:
        self._write_config_main(
            {
                "services": {
                    "matomo": {"enabled": True, "shared": True},
                    "redis": {"enabled": False},
                }
            }
        )

        links = load_service_links(self.role_dir)

        keys = {link.key: link for link in links}
        self.assertTrue(keys["matomo"].shared)
        self.assertFalse(keys["redis"].default_enabled)

    def test_config_main_features_and_services_collide_services_wins(self) -> None:
        self._write_config_main(
            {
                "features": {"matomo": False},
                "services": {"matomo": {"enabled": True, "shared": True}},
            }
        )

        links = load_service_links(self.role_dir)

        matomo = next(link for link in links if link.key == "matomo")
        self.assertTrue(matomo.default_enabled)
        self.assertTrue(matomo.shared)

    def test_config_main_skips_app_config_block(self) -> None:
        self._write_config_main(
            {
                "services": {
                    "matomo": {"enabled": True},
                    "akaunting": {"image": "x", "ports": {}},
                }
            }
        )

        links = load_service_links(self.role_dir)
        self.assertEqual({link.key for link in links}, {"matomo"})

    # ---------- precedence ----------

    def test_meta_wins_when_both_sources_present(self) -> None:
        self._write_meta_services({"matomo": {"enabled": True, "shared": True}})
        self._write_config_main({"features": {"matomo": False, "redis": True}})

        links = load_service_links(self.role_dir)

        # Only meta entries are surfaced — config is skipped entirely
        # since meta yielded a result.
        self.assertEqual({link.key for link in links}, {"matomo"})
        self.assertTrue(links[0].default_enabled)

    def test_no_sources_yields_empty_list(self) -> None:
        self.assertEqual(load_service_links(self.role_dir), [])

    # ---------- defensive ----------

    def test_malformed_yaml_does_not_raise(self) -> None:
        (self.role_dir / "meta").mkdir(exist_ok=True)
        (self.role_dir / "meta" / "services.yml").write_text(
            ":::\nnot valid yaml\n  -:", encoding="utf-8"
        )
        # Falls through to config/main.yml (also missing) -> [].
        self.assertEqual(load_service_links(self.role_dir), [])

    def test_meta_falls_through_when_only_app_config_blocks(self) -> None:
        # meta/services.yml present but contains only app-config blocks
        # -> should fall through to config/main.yml.
        self._write_meta_services({"akaunting": {"image": "x", "ports": {"http": 80}}})
        self._write_config_main(
            {"services": {"matomo": {"enabled": True, "shared": True}}}
        )

        links = load_service_links(self.role_dir)
        self.assertEqual({link.key for link in links}, {"matomo"})


if __name__ == "__main__":
    unittest.main()
