from __future__ import annotations

import unittest
from unittest.mock import patch

import services.infinito_nexus_versions as versions
from services.infinito_nexus_versions import InfinitoNexusVersionRecord


class TestInfinitoNexusVersions(unittest.TestCase):
    def setUp(self) -> None:
        with versions._CACHE_LOCK:
            versions._CACHE["expires_at"] = 0.0
            versions._CACHE["records"] = None

    def test_normalize_infinito_nexus_version_accepts_latest_and_semver(self) -> None:
        self.assertEqual(versions.normalize_infinito_nexus_version(None), "latest")
        self.assertEqual(versions.normalize_infinito_nexus_version("latest"), "latest")
        self.assertEqual(versions.normalize_infinito_nexus_version("v5.2.0"), "5.2.0")
        self.assertEqual(versions.normalize_infinito_nexus_version("5.1.0"), "5.1.0")

    @patch("services.infinito_nexus_versions._fetch_package_tags")
    def test_list_versions_returns_latest_and_sorted_stable_semvers(
        self, m_fetch
    ) -> None:
        m_fetch.return_value = [
            "v5.1.0",
            "v5.2.0",
            "latest",
            "ci-1234abcd",
            "v5.2.0-rc1",
        ]

        records = versions.list_infinito_nexus_versions(force_refresh=True)

        self.assertEqual(
            [record.value for record in records], ["latest", "5.2.0", "5.1.0"]
        )
        self.assertEqual(records[1].git_tag, "v5.2.0")
        self.assertEqual(records[1].image_tag, "v5.2.0")
        self.assertEqual(records[2].image_tag, "v5.1.0")

    @patch("services.infinito_nexus_versions.list_infinito_nexus_versions")
    def test_resolve_job_runner_image_replaces_the_tag(self, m_list_versions) -> None:
        m_list_versions.return_value = [
            InfinitoNexusVersionRecord(
                value="latest",
                label="latest",
                git_tag=None,
                image_tag="latest",
                commit_sha=None,
            ),
            InfinitoNexusVersionRecord(
                value="5.2.0",
                label="5.2.0",
                git_tag="v5.2.0",
                image_tag="v5.2.0",
                commit_sha=None,
            ),
        ]

        image = versions.resolve_job_runner_image(
            "5.2.0",
            base_image="ghcr.io/infinito-nexus/core/debian:latest",
        )

        self.assertEqual(
            image,
            "ghcr.io/infinito-nexus/core/debian:v5.2.0",
        )

    def test_resolve_job_runner_image_keeps_digest_pinned_latest_image(self) -> None:
        image = versions.resolve_job_runner_image(
            "latest",
            base_image="ghcr.io/infinito-nexus/core/debian@sha256:" + ("a" * 64),
        )

        self.assertEqual(
            image,
            "ghcr.io/infinito-nexus/core/debian@sha256:" + ("a" * 64),
        )

    @patch("services.infinito_nexus_versions._fetch_package_tags")
    def test_latest_falls_back_to_highest_semver_when_latest_tag_is_missing(
        self, m_fetch
    ) -> None:
        m_fetch.return_value = ["v5.1.0", "v5.2.0"]

        records = versions.list_infinito_nexus_versions(force_refresh=True)

        self.assertEqual(records[0].value, "latest")
        self.assertEqual(records[0].image_tag, "v5.2.0")


if __name__ == "__main__":
    unittest.main()
