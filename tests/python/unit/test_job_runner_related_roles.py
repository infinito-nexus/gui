import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch


class TestJobRunnerRelatedRoles(unittest.TestCase):
    def test_discovers_domains_from_static_load_app_id_tasks(self) -> None:
        with TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            dashboard_tasks = repo_root / "roles" / "web-app-dashboard" / "tasks"
            dashboard_tasks.mkdir(parents=True, exist_ok=True)
            (dashboard_tasks / "01_core.yml").write_text(
                "- name: Load simple icons\n"
                "  include_tasks: utils/load_app.yml\n"
                "  vars:\n"
                "    load_app_id: web-svc-simpleicons\n",
                encoding="utf-8",
            )

            simpleicons_config = repo_root / "roles" / "web-svc-simpleicons" / "config"
            simpleicons_config.mkdir(parents=True, exist_ok=True)
            (simpleicons_config / "main.yml").write_text(
                "server:\n"
                "  domains:\n"
                "    canonical:\n"
                "      - icons.{{ DOMAIN_PRIMARY }}\n",
                encoding="utf-8",
            )

            old_repo_path = os.environ.get("INFINITO_REPO_PATH")
            os.environ["INFINITO_REPO_PATH"] = str(repo_root)
            self.addCleanup(
                lambda: (
                    os.environ.pop("INFINITO_REPO_PATH", None)
                    if old_repo_path is None
                    else os.environ.__setitem__("INFINITO_REPO_PATH", old_repo_path)
                )
            )

            with patch(
                "services.job_runner.related_roles.RoleIndexService"
            ) as m_role_index:
                m_role_index.return_value.get.return_value = SimpleNamespace(
                    dependencies=[],
                    run_after=[],
                )

                from services.job_runner.related_roles import (  # noqa: WPS433
                    discover_related_role_domains,
                )

                mapping = discover_related_role_domains(
                    selected_roles=["web-app-dashboard"],
                    domain_primary="example.test",
                )

            self.assertEqual(
                mapping,
                {"web-svc-simpleicons": ["icons.example.test"]},
            )
