from __future__ import annotations

import copy
import importlib
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

import yaml
from fastapi import HTTPException

from .support import (
    _load_meta,
    _repo_root,
    _sanitize_host_filename,
    as_mapping,
    atomic_write_text,
    build_service_registry_from_role_configs,
    load_yaml_mapping_file,
    normalized_name,
    repo_roles_root,
    resolve_shared_service_dependency_roles,
    safe_mkdir,
    summarize_cli_failure,
)


def _root():
    return importlib.import_module("services.workspaces.mixins.artifacts.main")


class WorkspaceServiceArtifactsCredentialsMixin:
    def _load_effective_workspace_applications(
        self,
        *,
        root: Path,
        host_vars_path: Path,
    ) -> dict[str, Any]:
        merged: dict[str, Any] = {}
        for path in (root / "group_vars" / "all.yml", host_vars_path):
            applications = as_mapping(load_yaml_mapping_file(path).get("applications"))
            if applications:
                self._merge_mappings_inplace(merged, applications)
        return merged

    def _expand_credential_role_ids(
        self,
        *,
        root: Path,
        role_root: Path,
        host_vars_path: Path,
        role_ids: list[str],
    ) -> list[str]:
        effective_applications = self._load_effective_workspace_applications(
            root=root,
            host_vars_path=host_vars_path,
        )
        service_registry = build_service_registry_from_role_configs(role_root)
        queue = [normalized_name(role_id) for role_id in role_ids if role_id]
        expanded: list[str] = []
        seen: set[str] = set()

        while queue:
            role_id = normalized_name(queue.pop(0))
            if not role_id or role_id in seen:
                continue
            seen.add(role_id)
            expanded.append(role_id)

            effective_config = load_yaml_mapping_file(
                role_root / role_id / "config" / "main.yml"
            )
            override = effective_applications.get(role_id)
            if isinstance(override, dict) and override:
                if effective_config:
                    effective_config = copy.deepcopy(effective_config)
                    self._merge_mappings_inplace(effective_config, override)
                else:
                    effective_config = copy.deepcopy(override)

            for dependency_role in resolve_shared_service_dependency_roles(
                effective_config,
                service_registry,
            ):
                if dependency_role not in seen:
                    queue.append(dependency_role)

        return expanded

    def generate_credentials(
        self,
        workspace_id: str,
        master_password: str,
        selected_roles: list[str] | None,
        allow_empty_plain: bool,
        set_values: list[str] | None,
        force: bool,
        alias: str | None,
    ) -> None:
        with self.workspace_write_lock(workspace_id):
            root_module = _root()
            root = self.ensure(workspace_id)
            meta = _load_meta(root)
            role_ids = selected_roles or meta.get("selected_roles") or []
            if not role_ids:
                raise HTTPException(status_code=400, detail="no roles selected")

            vault_password = root_module._vault_password_from_kdbx(
                root,
                master_password,
                create_if_missing=True,
                provision_if_missing=True,
            )
            tmpfs_root = Path("/dev/shm")
            if not tmpfs_root.is_dir():
                raise HTTPException(
                    status_code=500,
                    detail="/dev/shm tmpfs is required for secure vault password staging",
                )
            try:
                with tempfile.TemporaryDirectory(
                    prefix="workspace-secret-",
                    dir=str(tmpfs_root),
                ) as secret_tmp:
                    secret_root = Path(secret_tmp)
                    try:
                        secret_root.chmod(0o700)
                    except Exception:
                        pass
                    vault_password_file = secret_root / "vault_password"
                    try:
                        vault_password_file.write_text(vault_password, encoding="utf-8")
                        vault_password_file.chmod(0o400)
                    except Exception as exc:
                        raise HTTPException(
                            status_code=500,
                            detail=f"failed to stage vault password in tmpfs: {exc}",
                        ) from exc

                    host_vars_file = None
                    alias_value = (alias or meta.get("alias") or "").strip()
                    if alias_value:
                        host_vars_file = (
                            f"host_vars/{_sanitize_host_filename(alias_value)}.yml"
                        )
                    if not host_vars_file:
                        host_vars_file = meta.get("host_vars_file")
                    if not host_vars_file:
                        host = (meta.get("host") or "").strip()
                        if not host:
                            raise HTTPException(
                                status_code=400,
                                detail="host missing for workspace",
                            )
                        host_vars_file = (
                            f"host_vars/{_sanitize_host_filename(host)}.yml"
                        )

                    host_vars_path = root_module._safe_resolve(root, host_vars_file)
                    if not host_vars_path.is_file():
                        host_vars_data: dict[str, Any] = {}
                        host = str(meta.get("host") or "").strip()
                        user = str(meta.get("user") or "").strip()
                        if host:
                            host_vars_data["ansible_host"] = host
                        if user:
                            host_vars_data["ansible_user"] = user
                        try:
                            raw_port = meta.get("port")
                            if raw_port is not None:
                                port = int(raw_port)
                                if 1 <= port <= 65535:
                                    host_vars_data["ansible_port"] = port
                        except Exception:
                            pass

                        try:
                            safe_mkdir(host_vars_path.parent)
                            atomic_write_text(
                                host_vars_path,
                                yaml.safe_dump(
                                    host_vars_data,
                                    sort_keys=False,
                                    default_flow_style=False,
                                    allow_unicode=True,
                                ),
                            )
                        except Exception as exc:
                            raise HTTPException(
                                status_code=500,
                                detail=f"failed to create host vars file: {exc}",
                            ) from exc

                    role_root = repo_roles_root()
                    role_ids = self._expand_credential_role_ids(
                        root=root,
                        role_root=role_root,
                        host_vars_path=host_vars_path,
                        role_ids=role_ids,
                    )
                    repo_root = _repo_root()
                    env = os.environ.copy()
                    repo_root_str = str(repo_root)
                    env["PYTHONPATH"] = (
                        f"{repo_root_str}{os.pathsep}{env['PYTHONPATH']}"
                        if env.get("PYTHONPATH")
                        else repo_root_str
                    )
                    with tempfile.TemporaryDirectory(
                        prefix="workspace-cli-home-",
                    ) as cli_tmp:
                        cli_root = Path(cli_tmp)
                        cli_home = cli_root / "home"
                        cli_cache = cli_root / ".cache"
                        cli_tmpdir = cli_root / "tmp"
                        cli_ansible_tmp = cli_home / ".ansible" / "tmp"
                        for path in (cli_home, cli_cache, cli_tmpdir, cli_ansible_tmp):
                            safe_mkdir(path)
                            try:
                                path.chmod(0o700)
                            except Exception:
                                pass

                        env["HOME"] = str(cli_home)
                        env["TMPDIR"] = str(cli_tmpdir)
                        env["XDG_CACHE_HOME"] = str(cli_cache)
                        env["ANSIBLE_LOCAL_TEMP"] = str(cli_ansible_tmp)

                        for role_id in role_ids:
                            role_dir = role_root / role_id
                            if not role_dir.is_dir():
                                raise HTTPException(
                                    status_code=400,
                                    detail=f"role not found: {role_id}",
                                )

                            command = [
                                sys.executable,
                                "-m",
                                "cli.create.credentials",
                                "--role-path",
                                str(role_dir),
                                "--inventory-file",
                                str(host_vars_path),
                                "--vault-password-file",
                                str(vault_password_file),
                            ]
                            if allow_empty_plain:
                                command.append("--allow-empty-plain")
                            if force:
                                command.extend(["--force", "--yes"])
                            for item in set_values or []:
                                if item:
                                    command.extend(["--set", item])

                            result = root_module.subprocess.run(
                                command,
                                capture_output=True,
                                text=True,
                                check=False,
                                cwd=str(repo_root),
                                env=env,
                            )
                            if result.returncode != 0:
                                detail = (
                                    f"credential generation failed for {role_id} "
                                    f"(exit {result.returncode})"
                                )
                                summary = summarize_cli_failure(result.stderr)
                                if summary:
                                    detail = f"{detail}: {summary}"
                                raise HTTPException(status_code=500, detail=detail)
            finally:
                vault_password = ""

            self._history_commit(root, "bulk: credential generation")
