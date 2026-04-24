from __future__ import annotations

import stat
from pathlib import Path
from typing import Any


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

ZIP_IMPORT_MODES = {"override", "merge"}


def as_mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def normalized_name(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def load_yaml_mapping_file(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        loaded = load_workspace_yaml_document(
            path.read_text(encoding="utf-8", errors="replace")
        )
    except Exception:
        return {}
    return loaded if isinstance(loaded, dict) else {}


def flatten_role_categories(tree: dict[str, Any], prefix: str = "") -> list[str]:
    result: list[str] = []
    for key, value in tree.items():
        if not isinstance(key, str):
            continue
        current = f"{prefix}-{key}" if prefix else key
        result.append(current)
        if isinstance(value, dict):
            result.extend(flatten_role_categories(value, current))
    return result


def resolve_role_entity_name(role_root: Path, role_name: str) -> str:
    categories = as_mapping(
        load_yaml_mapping_file(role_root / "categories.yml").get("roles")
    )
    if categories:
        role_name_lc = role_name.lower()
        for category in sorted(
            flatten_role_categories(categories), key=len, reverse=True
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


def discover_role_services(
    *,
    role_root: Path,
    role_name: str,
    config: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    services = as_mapping(as_mapping(config.get("compose")).get("services"))
    entity_name = resolve_role_entity_name(role_root, role_name)
    primary_entry = as_mapping(services.get(entity_name))
    alias_entries = {
        key: as_mapping(entry)
        for key, entry in services.items()
        if isinstance(entry, dict)
        and normalized_name(as_mapping(entry).get("canonical")) == entity_name
    }

    provides = normalized_name(primary_entry.get("provides"))
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


def build_service_registry_from_role_configs(
    role_root: Path,
) -> dict[str, dict[str, Any]]:
    if not role_root.is_dir():
        return {}

    registry: dict[str, dict[str, Any]] = {}
    for role_dir in sorted(path for path in role_root.iterdir() if path.is_dir()):
        config = load_yaml_mapping_file(role_dir / "config" / "main.yml")
        if not config:
            continue
        for service_key, entry in discover_role_services(
            role_root=role_root,
            role_name=role_dir.name,
            config=config,
        ).items():
            registry.setdefault(service_key, entry)
    return registry


def resolve_shared_service_dependency_roles(
    config: dict[str, Any],
    service_registry: dict[str, dict[str, Any]],
) -> list[str]:
    services = as_mapping(as_mapping(config.get("compose")).get("services"))
    resolved: list[str] = []
    seen: set[str] = set()
    for service_key, service_conf in services.items():
        service_conf = as_mapping(service_conf)
        if not (
            service_conf.get("enabled") is True and service_conf.get("shared") is True
        ):
            continue

        entry = as_mapping(service_registry.get(service_key))
        role_name = normalized_name(entry.get("role"))
        if not role_name or role_name in seen:
            continue
        seen.add(role_name)
        resolved.append(role_name)
    return resolved


def zip_member_mode(info) -> int:
    return (int(getattr(info, "external_attr", 0)) >> 16) & 0o177777


def zip_member_is_symlink(info) -> bool:
    mode = zip_member_mode(info)
    return bool(mode) and stat.S_ISLNK(mode)


def zip_member_has_unsafe_mode(info) -> bool:
    mode = zip_member_mode(info)
    return bool(mode) and bool(mode & 0o022)


def summarize_cli_failure(stderr: str) -> str:
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
