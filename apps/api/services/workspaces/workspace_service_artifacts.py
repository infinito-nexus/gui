from __future__ import annotations

import copy
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Any

import yaml
from fastapi import HTTPException

from services.job_runner.secrets import mask_secrets
from services.job_runner.util import atomic_write_text, safe_mkdir
from services.role_index.paths import repo_roles_root
from .workspace_context import (
    INVENTORY_FILENAME,
    WORKSPACE_META_FILENAME,
    _dump_yaml_mapping,
    _load_meta,
    _now_iso,
    _repo_root,
    _safe_resolve,
    _sanitize_host_filename,
    _write_meta,
    load_workspace_yaml_document,
)
from .vault import _vault_password_from_kdbx

_ZIP_IMPORT_MODES = {"override", "merge"}


def _as_mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _normalized_name(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _load_yaml_mapping_file(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        loaded = load_workspace_yaml_document(
            path.read_text(encoding="utf-8", errors="replace")
        )
    except Exception:
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _flatten_role_categories(tree: dict[str, Any], prefix: str = "") -> list[str]:
    result: list[str] = []
    for key, value in tree.items():
        if not isinstance(key, str):
            continue
        current = f"{prefix}-{key}" if prefix else key
        result.append(current)
        if isinstance(value, dict):
            result.extend(_flatten_role_categories(value, current))
    return result


def _resolve_role_entity_name(role_root: Path, role_name: str) -> str:
    categories = _as_mapping(
        _load_yaml_mapping_file(role_root / "categories.yml").get("roles")
    )
    if categories:
        role_name_lc = role_name.lower()
        for category in sorted(
            _flatten_role_categories(categories), key=len, reverse=True
        ):
            category_lc = category.lower()
            if role_name_lc.startswith(category_lc + "-"):
                return role_name[len(category) + 1 :]
            if role_name_lc == category_lc:
                return ""

    for prefix in (
        "web-app-",
        "web-svc-",
        "svc-db-",
        "svc-ai-",
        "svc-",
        "sys-",
        "desk-",
        "drv-",
    ):
        if role_name.startswith(prefix):
            return role_name[len(prefix) :]
    return role_name


def _discover_role_services(
    *, role_root: Path, role_name: str, config: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    services = _as_mapping(_as_mapping(config.get("compose")).get("services"))
    entity_name = _resolve_role_entity_name(role_root, role_name)
    primary_entry = _as_mapping(services.get(entity_name))
    alias_entries = {
        key: _as_mapping(entry)
        for key, entry in services.items()
        if isinstance(entry, dict)
        and _normalized_name(_as_mapping(entry).get("canonical")) == entity_name
    }

    provides = _normalized_name(primary_entry.get("provides"))
    if provides == entity_name:
        provides = ""

    is_provider = bool(primary_entry) and (
        "shared" in primary_entry or "provides" in primary_entry or alias_entries
    )
    primary_id = provides or entity_name
    if not is_provider or not primary_id:
        return {}

    base_entry = {"role": role_name}
    discovered = {primary_id: base_entry}
    for alias_key in sorted(alias_entries):
        discovered[alias_key] = {
            **base_entry,
            "canonical": primary_id,
        }
    return discovered


def _build_service_registry_from_role_configs(
    role_root: Path,
) -> dict[str, dict[str, Any]]:
    if not role_root.is_dir():
        return {}

    registry: dict[str, dict[str, Any]] = {}
    for role_dir in sorted(path for path in role_root.iterdir() if path.is_dir()):
        config = _load_yaml_mapping_file(role_dir / "config" / "main.yml")
        if not config:
            continue
        for service_key, entry in _discover_role_services(
            role_root=role_root,
            role_name=role_dir.name,
            config=config,
        ).items():
            registry.setdefault(service_key, entry)
    return registry


def _resolve_shared_service_dependency_roles(
    config: dict[str, Any],
    service_registry: dict[str, dict[str, Any]],
) -> list[str]:
    services = _as_mapping(_as_mapping(config.get("compose")).get("services"))
    resolved: list[str] = []
    seen: set[str] = set()
    for service_key, service_conf in services.items():
        service_conf = _as_mapping(service_conf)
        if not (
            service_conf.get("enabled") is True and service_conf.get("shared") is True
        ):
            continue

        entry = _as_mapping(service_registry.get(service_key))
        role_name = _normalized_name(entry.get("role"))
        if not role_name or role_name in seen:
            continue
        seen.add(role_name)
        resolved.append(role_name)
    return resolved


def _zip_member_mode(info) -> int:
    return (int(getattr(info, "external_attr", 0)) >> 16) & 0o177777


def _zip_member_is_symlink(info) -> bool:
    mode = _zip_member_mode(info)
    return bool(mode) and stat.S_ISLNK(mode)


def _zip_member_has_unsafe_mode(info) -> bool:
    mode = _zip_member_mode(info)
    return bool(mode) and bool(mode & 0o022)


def _summarize_cli_failure(stderr: str) -> str:
    text = mask_secrets(stderr or "", [])
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines:
        if line.startswith("ERROR:"):
            return line
    for line in reversed(lines):
        if line.startswith("Traceback"):
            continue
        if line.startswith("File "):
            continue
        return line
    return ""


class WorkspaceServiceArtifactsMixin:
    def _load_effective_workspace_applications(
        self,
        *,
        root: Path,
        host_vars_path: Path,
    ) -> dict[str, Any]:
        merged: dict[str, Any] = {}
        for path in (root / "group_vars" / "all.yml", host_vars_path):
            applications = _as_mapping(
                _load_yaml_mapping_file(path).get("applications")
            )
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
        service_registry = _build_service_registry_from_role_configs(role_root)
        queue = [_normalized_name(role_id) for role_id in role_ids if role_id]
        expanded: list[str] = []
        seen: set[str] = set()

        while queue:
            role_id = _normalized_name(queue.pop(0))
            if not role_id or role_id in seen:
                continue
            seen.add(role_id)
            expanded.append(role_id)

            effective_config = _load_yaml_mapping_file(
                role_root / role_id / "config" / "main.yml"
            )
            override = effective_applications.get(role_id)
            if isinstance(override, dict) and override:
                if effective_config:
                    effective_config = copy.deepcopy(effective_config)
                    self._merge_mappings_inplace(effective_config, override)
                else:
                    effective_config = copy.deepcopy(override)

            for dependency_role in _resolve_shared_service_dependency_roles(
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
            root = self.ensure(workspace_id)
            meta = _load_meta(root)
            role_ids = selected_roles or meta.get("selected_roles") or []
            if not role_ids:
                raise HTTPException(status_code=400, detail="no roles selected")

            vault_password = _vault_password_from_kdbx(
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
                    prefix="workspace-secret-", dir=str(tmpfs_root)
                ) as secret_tmp:
                    secret_root = Path(secret_tmp)
                    try:
                        secret_root.chmod(0o700)
                    except Exception:
                        pass
                    vault_password_file = secret_root / "vault_password"
                    try:
                        vault_password_file.write_text(
                            vault_password,
                            encoding="utf-8",
                        )
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
                                status_code=400, detail="host missing for workspace"
                            )
                        host_vars_file = (
                            f"host_vars/{_sanitize_host_filename(host)}.yml"
                        )

                    host_vars_path = _safe_resolve(root, host_vars_file)
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
                        prefix="workspace-cli-home-"
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
                                    status_code=400, detail=f"role not found: {role_id}"
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

                            result = subprocess.run(
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
                                summary = _summarize_cli_failure(result.stderr)
                                if summary:
                                    detail = f"{detail}: {summary}"
                                raise HTTPException(status_code=500, detail=detail)
            finally:
                vault_password = ""

            self._history_commit(root, "bulk: credential generation")

    def build_zip(self, workspace_id: str) -> bytes:
        import zipfile

        root = self.ensure(workspace_id)
        buffer = BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for dirpath, _dirnames, filenames in os.walk(root):
                current_dir = Path(dirpath)
                for filename in filenames:
                    if filename == WORKSPACE_META_FILENAME:
                        continue
                    file_path = current_dir / filename
                    archive.write(file_path, file_path.relative_to(root).as_posix())
        return buffer.getvalue()

    def _refresh_meta_after_upload(self, root: Path) -> None:
        meta = _load_meta(root)
        changed = False

        inventory_path = root / INVENTORY_FILENAME
        if inventory_path.exists() and not meta.get("inventory_generated_at"):
            meta["inventory_generated_at"] = _now_iso()
            changed = True

        host_vars_file = meta.get("host_vars_file")
        if host_vars_file:
            try:
                if not _safe_resolve(root, host_vars_file).is_file():
                    host_vars_file = None
            except HTTPException:
                host_vars_file = None

        if not host_vars_file:
            host_vars_dir = root / "host_vars"
            if host_vars_dir.is_dir():
                candidates = sorted(
                    [
                        path
                        for path in host_vars_dir.iterdir()
                        if path.is_file() and path.suffix in (".yml", ".yaml")
                    ]
                )
                if candidates:
                    meta["host_vars_file"] = f"host_vars/{candidates[0].name}"
                    changed = True

        if changed:
            _write_meta(root, meta)

    def _normalize_zip_member_path(self, name: str) -> str | None:
        raw = (name or "").replace("\\", "/")
        if not raw or raw.endswith("/"):
            return None
        if raw.startswith("/") or raw.startswith("\\"):
            return None
        if re.match(r"^[A-Za-z]:", raw):
            return None

        parts = [part for part in raw.split("/") if part]
        if not parts or any(part == ".." for part in parts):
            return None
        if any(part == WORKSPACE_META_FILENAME for part in parts):
            return None
        return "/".join(parts)

    def _resolve_zip_mode(
        self,
        rel_path: str,
        *,
        default_mode: str,
        per_file_mode: dict[str, str] | None,
    ) -> str:
        mode = (
            str((per_file_mode or {}).get(rel_path) or default_mode or "override")
            .strip()
            .lower()
        )
        return mode if mode in _ZIP_IMPORT_MODES else "override"

    def _merge_mappings_inplace(
        self, destination: dict[str, Any], source: dict[str, Any]
    ) -> None:
        for key, value in source.items():
            if (
                key in destination
                and isinstance(destination[key], dict)
                and isinstance(value, dict)
            ):
                self._merge_mappings_inplace(destination[key], value)
                continue
            destination[key] = copy.deepcopy(value)

    def _merge_structured_bytes(
        self, rel_path: str, existing: bytes, incoming: bytes
    ) -> bytes | None:
        lowered = rel_path.lower()

        if lowered.endswith((".yml", ".yaml")):
            try:
                existing_loaded = load_workspace_yaml_document(
                    existing.decode("utf-8", errors="strict") or "{}"
                )
                incoming_loaded = load_workspace_yaml_document(
                    incoming.decode("utf-8", errors="strict") or "{}"
                )
            except Exception:
                return None

            if existing_loaded is None:
                existing_loaded = {}
            if incoming_loaded is None:
                incoming_loaded = {}
            if not isinstance(existing_loaded, dict) or not isinstance(
                incoming_loaded, dict
            ):
                return None

            merged = copy.deepcopy(existing_loaded)
            self._merge_mappings_inplace(merged, incoming_loaded)
            return _dump_yaml_mapping(merged).encode("utf-8")

        if lowered.endswith(".json"):
            try:
                existing_loaded = json.loads(
                    existing.decode("utf-8", errors="strict") or "{}"
                )
                incoming_loaded = json.loads(
                    incoming.decode("utf-8", errors="strict") or "{}"
                )
            except Exception:
                return None

            if not isinstance(existing_loaded, dict) or not isinstance(
                incoming_loaded, dict
            ):
                return None

            merged = copy.deepcopy(existing_loaded)
            self._merge_mappings_inplace(merged, incoming_loaded)
            content = json.dumps(merged, ensure_ascii=False, indent=2, sort_keys=False)
            if not content.endswith("\n"):
                content = f"{content}\n"
            return content.encode("utf-8")

        return None

    def list_zip_entries(self, data: bytes) -> list[str]:
        import zipfile

        try:
            archive = zipfile.ZipFile(BytesIO(data))
        except Exception as exc:
            raise HTTPException(status_code=400, detail="invalid zip") from exc

        entries: set[str] = set()
        with archive:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                rel_path = self._normalize_zip_member_path(info.filename or "")
                if rel_path:
                    entries.add(rel_path)
        return sorted(entries)

    def load_zip(
        self,
        workspace_id: str,
        data: bytes,
        *,
        default_mode: str = "override",
        per_file_mode: dict[str, str] | None = None,
    ) -> dict[str, int]:
        import zipfile

        with self.workspace_write_lock(workspace_id):
            root = self.ensure(workspace_id)
            try:
                archive = zipfile.ZipFile(BytesIO(data))
            except Exception as exc:
                raise HTTPException(status_code=400, detail="invalid zip") from exc

            default_mode_normalized = str(default_mode or "override").strip().lower()
            if default_mode_normalized not in _ZIP_IMPORT_MODES:
                default_mode_normalized = "override"

            root_resolved = root.resolve()
            created_files = 0
            overridden_files = 0
            merged_files = 0
            skipped_files = 0

            with archive:
                for info in archive.infolist():
                    if info.is_dir():
                        continue

                    if _zip_member_is_symlink(info):
                        raise HTTPException(
                            status_code=400,
                            detail=f"zip import rejected symlink entry: {info.filename}",
                        )
                    if _zip_member_has_unsafe_mode(info):
                        raise HTTPException(
                            status_code=400,
                            detail=f"zip import rejected writable entry: {info.filename}",
                        )

                    rel_path = self._normalize_zip_member_path(info.filename or "")
                    if not rel_path:
                        continue

                    target = root / rel_path
                    resolved = target.resolve()
                    if (
                        resolved == root_resolved
                        or root_resolved not in resolved.parents
                    ):
                        raise HTTPException(
                            status_code=400,
                            detail=f"zip import rejected path traversal entry: {info.filename}",
                        )

                    safe_mkdir(resolved.parent)
                    try:
                        with archive.open(info) as source:
                            incoming_bytes = source.read()
                    except Exception as exc:
                        raise HTTPException(
                            status_code=500, detail=f"failed to extract zip: {exc}"
                        ) from exc

                    existing_bytes: bytes | None = None
                    if resolved.is_file():
                        try:
                            existing_bytes = resolved.read_bytes()
                        except Exception:
                            existing_bytes = None

                    mode = self._resolve_zip_mode(
                        rel_path,
                        default_mode=default_mode_normalized,
                        per_file_mode=per_file_mode,
                    )

                    payload = incoming_bytes
                    if mode == "merge" and existing_bytes is not None:
                        merged_payload = self._merge_structured_bytes(
                            rel_path, existing_bytes, incoming_bytes
                        )
                        if merged_payload is None:
                            skipped_files += 1
                            continue
                        payload = merged_payload
                        merged_files += 1
                        if payload == existing_bytes:
                            continue
                    else:
                        if resolved.exists():
                            overridden_files += 1
                        else:
                            created_files += 1

                    try:
                        with open(resolved, "wb") as destination:
                            destination.write(payload)
                    except Exception as exc:
                        raise HTTPException(
                            status_code=500, detail=f"failed to extract zip: {exc}"
                        ) from exc

            self._refresh_meta_after_upload(root)
            self._history_commit(root, "bulk: zip import")
            return {
                "created_files": created_files,
                "overridden_files": overridden_files,
                "merged_files": merged_files,
                "skipped_files": skipped_files,
            }
