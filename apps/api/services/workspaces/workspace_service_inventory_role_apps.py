from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from fastapi import HTTPException

from services.job_runner.util import atomic_write_text
from services.role_index.paths import repo_roles_root
from .workspace_context import (
    _WorkspaceYamlLoader,
    _dump_yaml_fragment,
    _dump_yaml_mapping,
    _load_meta,
    _load_yaml_mapping,
    _merge_missing,
    _sanitize_role_id,
)


class WorkspaceServiceInventoryRoleAppsMixin:
    def _ensure_role_exists(self, role_id: str) -> None:
        role_dir = repo_roles_root() / role_id
        if not role_dir.is_dir():
            raise HTTPException(status_code=404, detail=f"role not found: {role_id}")

    def _load_role_defaults(self, role_id: str) -> dict[str, Any]:
        role_dir = repo_roles_root() / role_id
        if not role_dir.is_dir():
            raise HTTPException(status_code=404, detail=f"role not found: {role_id}")
        defaults_path = role_dir / "config" / "main.yml"
        if not defaults_path.is_file():
            return {}
        return _load_yaml_mapping(defaults_path)

    def _read_role_app_context(
        self, workspace_id: str, role_id: str, alias: str | None
    ) -> tuple[Path, Path, str, dict[str, Any], dict[str, Any], dict[str, Any]]:
        normalized_role_id = _sanitize_role_id(role_id)
        self._ensure_role_exists(normalized_role_id)

        root = self.ensure(workspace_id)
        meta = _load_meta(root)
        host_vars_path, alias_value = self._resolve_host_vars_path(root, meta, alias)
        self._ensure_host_vars_file(host_vars_path, meta, alias)
        host_vars_data = _load_yaml_mapping(host_vars_path)

        applications = host_vars_data.get("applications")
        if applications is None:
            applications = {}
            host_vars_data["applications"] = applications
        if not isinstance(applications, dict):
            raise HTTPException(
                status_code=400,
                detail="host_vars applications section must be a mapping",
            )

        section = applications.get(normalized_role_id)
        if section is None:
            section = {}
        if not isinstance(section, dict):
            raise HTTPException(
                status_code=400,
                detail=f"applications.{normalized_role_id} must be a mapping",
            )

        return (
            root,
            host_vars_path,
            alias_value,
            host_vars_data,
            applications,
            section,
        )

    def read_role_app_config(
        self, workspace_id: str, role_id: str, alias: str | None
    ) -> dict[str, Any]:
        normalized_role_id = _sanitize_role_id(role_id)
        (
            root,
            host_vars_path,
            alias_value,
            _host_vars_data,
            _applications,
            section,
        ) = self._read_role_app_context(workspace_id, normalized_role_id, alias)
        return {
            "role_id": normalized_role_id,
            "alias": alias_value,
            "host_vars_path": host_vars_path.relative_to(root).as_posix(),
            "content": _dump_yaml_fragment(section),
        }

    def write_role_app_config(
        self, workspace_id: str, role_id: str, alias: str | None, content: str
    ) -> dict[str, Any]:
        with self.workspace_write_lock(workspace_id):
            normalized_role_id = _sanitize_role_id(role_id)
            (
                root,
                host_vars_path,
                alias_value,
                host_vars_data,
                applications,
                _section,
            ) = self._read_role_app_context(workspace_id, normalized_role_id, alias)

            parsed = yaml.load(
                (content or "").strip() or "{}", Loader=_WorkspaceYamlLoader
            )
            if parsed is None:
                parsed = {}
            if not isinstance(parsed, dict):
                raise HTTPException(
                    status_code=400,
                    detail=f"applications.{normalized_role_id} must be a YAML mapping",
                )

            applications[normalized_role_id] = parsed
            try:
                atomic_write_text(host_vars_path, _dump_yaml_mapping(host_vars_data))
            except Exception as exc:
                raise HTTPException(
                    status_code=500, detail=f"failed to write host vars file: {exc}"
                ) from exc
            self._history_commit(
                root,
                f"edit: {host_vars_path.relative_to(root).as_posix()}",
                metadata={"server": alias_value, "role": normalized_role_id},
            )

            return {
                "role_id": normalized_role_id,
                "alias": alias_value,
                "host_vars_path": host_vars_path.relative_to(root).as_posix(),
                "content": _dump_yaml_fragment(parsed),
            }

    def import_role_app_defaults(
        self, workspace_id: str, role_id: str, alias: str | None
    ) -> dict[str, Any]:
        with self.workspace_write_lock(workspace_id):
            normalized_role_id = _sanitize_role_id(role_id)
            defaults = self._load_role_defaults(normalized_role_id)
            (
                root,
                host_vars_path,
                alias_value,
                host_vars_data,
                applications,
                section,
            ) = self._read_role_app_context(workspace_id, normalized_role_id, alias)

            imported_paths = _merge_missing(section, defaults)
            applications[normalized_role_id] = section
            if imported_paths > 0:
                try:
                    atomic_write_text(
                        host_vars_path, _dump_yaml_mapping(host_vars_data)
                    )
                except Exception as exc:
                    raise HTTPException(
                        status_code=500,
                        detail=f"failed to write host vars file: {exc}",
                    ) from exc
                self._history_commit(
                    root,
                    f"context: import role defaults ({normalized_role_id})",
                    metadata={"server": alias_value, "role": normalized_role_id},
                )

            return {
                "role_id": normalized_role_id,
                "alias": alias_value,
                "host_vars_path": host_vars_path.relative_to(root).as_posix(),
                "content": _dump_yaml_fragment(section),
                "imported_paths": imported_paths,
            }
