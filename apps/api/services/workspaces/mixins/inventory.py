from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from fastapi import HTTPException

from services.job_runner.util import atomic_write_text, safe_mkdir
from ..vault import _ensure_secrets_dirs
from .context import (
    INVENTORY_FILENAME,
    _apply_cli_host_vars_defaults,
    _build_inventory,
    _dump_yaml_mapping,
    _load_meta,
    _load_yaml_mapping,
    _now_iso,
    _safe_resolve,
    _sanitize_host_filename,
    _write_meta,
)
from .inventory_role_apps import (
    WorkspaceServiceInventoryRoleAppsMixin,
)


class WorkspaceServiceInventoryMixin(WorkspaceServiceInventoryRoleAppsMixin):
    def _merge_inventory_roles(
        self, root: Path, *, alias: str, selected_roles: list[str]
    ) -> None:
        inventory_path = root / INVENTORY_FILENAME
        data = _load_yaml_mapping(inventory_path) if inventory_path.is_file() else {}
        all_node = data.get("all")
        if not isinstance(all_node, dict):
            all_node = {}
            data["all"] = all_node

        children = all_node.get("children")
        if not isinstance(children, dict):
            children = {}
            all_node["children"] = children

        hosts = all_node.get("hosts")
        if not isinstance(hosts, dict):
            hosts = {}
            all_node["hosts"] = hosts

        changed = False
        if alias not in hosts:
            hosts[alias] = {}
            changed = True

        for role_id in selected_roles:
            role_name = str(role_id or "").strip()
            if not role_name:
                continue
            entry = children.get(role_name)
            if not isinstance(entry, dict):
                entry = {}
                children[role_name] = entry
                changed = True
            role_hosts = entry.get("hosts")
            if not isinstance(role_hosts, dict):
                role_hosts = {}
                entry["hosts"] = role_hosts
                changed = True
            if alias not in role_hosts:
                role_hosts[alias] = {}
                changed = True

        if changed:
            atomic_write_text(inventory_path, _dump_yaml_mapping(data))

    def _resolve_host_vars_path(
        self, root: Path, meta: dict[str, Any], alias: str | None
    ) -> tuple[Path, str]:
        alias_value = (alias or meta.get("alias") or "").strip()
        if alias_value:
            return (
                root / "host_vars" / f"{_sanitize_host_filename(alias_value)}.yml",
                alias_value,
            )

        host_vars_file = str(meta.get("host_vars_file") or "").strip()
        if host_vars_file:
            try:
                return _safe_resolve(root, host_vars_file), Path(
                    host_vars_file
                ).stem or "host"
            except HTTPException:
                pass

        host_value = str(meta.get("host") or "").strip()
        if host_value:
            return (
                root / "host_vars" / f"{_sanitize_host_filename(host_value)}.yml",
                host_value,
            )

        raise HTTPException(status_code=400, detail="host vars target not resolved")

    def _ensure_host_vars_file(
        self, path: Path, meta: dict[str, Any], alias: str | None
    ) -> None:
        del alias
        if path.is_file():
            return

        data: dict[str, Any] = {}
        host_value = str(meta.get("host") or "").strip()
        user_value = str(meta.get("user") or "").strip()
        if host_value:
            data["ansible_host"] = host_value
        if user_value:
            data["ansible_user"] = user_value
        try:
            raw_port = meta.get("port")
            if raw_port is not None:
                port = int(raw_port)
                if 1 <= port <= 65535:
                    data["ansible_port"] = port
        except Exception:
            pass

        safe_mkdir(path.parent)
        try:
            atomic_write_text(path, _dump_yaml_mapping(data))
        except Exception as exc:
            raise HTTPException(
                status_code=500, detail=f"failed to create host vars file: {exc}"
            ) from exc

    def _ensure_inventory_alias(self, root: Path, alias: str) -> None:
        inventory_path = root / INVENTORY_FILENAME
        data = _load_yaml_mapping(inventory_path) if inventory_path.is_file() else {}

        all_node = data.get("all")
        if not isinstance(all_node, dict):
            all_node = {}
            data["all"] = all_node

        hosts = all_node.get("hosts")
        if not isinstance(hosts, dict):
            hosts = {}
            all_node["hosts"] = hosts
        if alias in hosts:
            return

        hosts[alias] = {}
        atomic_write_text(inventory_path, _dump_yaml_mapping(data))

    def upsert_provider_device(
        self,
        workspace_id: str,
        *,
        alias: str,
        host: str,
        user: str,
        port: int,
        provider_metadata: dict[str, Any],
        primary_domain: str | None = None,
    ) -> dict[str, Any]:
        with self.workspace_write_lock(workspace_id):
            root = self.ensure(workspace_id)
            alias_value = (alias or "").strip()
            if not alias_value:
                raise HTTPException(status_code=400, detail="alias is required")

            host_value = (host or "").strip()
            user_value = (user or "").strip()
            if not host_value or not user_value:
                raise HTTPException(
                    status_code=400, detail="host and user are required"
                )
            if port < 1 or port > 65535:
                raise HTTPException(status_code=400, detail="port out of range")

            host_vars_path = (
                root / "host_vars" / f"{_sanitize_host_filename(alias_value)}.yml"
            )
            existing = _load_yaml_mapping(host_vars_path)
            existing["ansible_host"] = host_value
            existing["ansible_user"] = user_value
            existing["ansible_port"] = int(port)

            infinito = existing.get("infinito")
            if not isinstance(infinito, dict):
                infinito = {}
            device = infinito.get("device")
            if not isinstance(device, dict):
                device = {}

            for key, value in provider_metadata.items():
                if value is not None:
                    device[str(key)] = value
            infinito["device"] = device
            existing["infinito"] = infinito

            primary_domain_value = (primary_domain or "").strip()
            if primary_domain_value:
                existing["DOMAIN_PRIMARY"] = primary_domain_value
            else:
                existing.pop("DOMAIN_PRIMARY", None)

            safe_mkdir(host_vars_path.parent)
            atomic_write_text(host_vars_path, _dump_yaml_mapping(existing))
            self._ensure_inventory_alias(root, alias_value)
            self._history_commit(
                root,
                f"context: update provider device ({alias_value})",
                metadata={"server": alias_value},
            )

            return {
                "alias": alias_value,
                "host_vars_path": host_vars_path.relative_to(root).as_posix(),
                "primary_domain": primary_domain_value or None,
            }

    def set_primary_domain(
        self, workspace_id: str, *, alias: str, primary_domain: str | None
    ) -> dict[str, Any]:
        with self.workspace_write_lock(workspace_id):
            root = self.ensure(workspace_id)
            alias_value = (alias or "").strip()
            if not alias_value:
                raise HTTPException(status_code=400, detail="alias is required")

            host_vars_path = (
                root / "host_vars" / f"{_sanitize_host_filename(alias_value)}.yml"
            )
            data = _load_yaml_mapping(host_vars_path)
            primary_domain_value = (primary_domain or "").strip()
            if primary_domain_value:
                data["DOMAIN_PRIMARY"] = primary_domain_value
            else:
                data.pop("DOMAIN_PRIMARY", None)

            safe_mkdir(host_vars_path.parent)
            atomic_write_text(host_vars_path, _dump_yaml_mapping(data))
            self._ensure_inventory_alias(root, alias_value)
            self._history_commit(
                root,
                f"context: set primary domain ({alias_value})",
                metadata={"server": alias_value},
            )

            return {
                "alias": alias_value,
                "host_vars_path": host_vars_path.relative_to(root).as_posix(),
                "primary_domain": primary_domain_value or None,
            }

    def upsert_server_connection(
        self,
        workspace_id: str,
        *,
        alias: str,
        host: str,
        user: str,
        port: int | None,
    ) -> dict[str, Any]:
        with self.workspace_write_lock(workspace_id):
            root = self.ensure(workspace_id)
            alias_value = (alias or "").strip()
            if not alias_value:
                raise HTTPException(status_code=400, detail="alias is required")

            host_value = (host or "").strip()
            user_value = (user or "").strip()
            if not host_value or not user_value:
                raise HTTPException(
                    status_code=400, detail="host and user are required"
                )
            if port is not None and (port < 1 or port > 65535):
                raise HTTPException(status_code=400, detail="port out of range")

            host_vars_path = (
                root / "host_vars" / f"{_sanitize_host_filename(alias_value)}.yml"
            )
            existing = _load_yaml_mapping(host_vars_path)
            existing["ansible_host"] = host_value
            existing["ansible_user"] = user_value
            if port is not None:
                existing["ansible_port"] = int(port)

            safe_mkdir(host_vars_path.parent)
            atomic_write_text(host_vars_path, _dump_yaml_mapping(existing))
            self._ensure_inventory_alias(root, alias_value)
            self._history_commit(
                root,
                f"context: update server connection ({alias_value})",
                metadata={"server": alias_value},
            )

            return {
                "alias": alias_value,
                "host_vars_path": host_vars_path.relative_to(root).as_posix(),
                "host": host_value,
                "user": user_value,
                "port": int(port) if port is not None else None,
            }

    def generate_inventory(self, workspace_id: str, payload: dict[str, Any]) -> None:
        with self.workspace_write_lock(workspace_id):
            root = self.ensure(workspace_id)
            inventory_path = root / INVENTORY_FILENAME

            safe_mkdir(root / "host_vars")
            safe_mkdir(root / "group_vars")

            alias = (payload.get("alias") or "").strip()
            host = (payload.get("host") or "").strip()
            port = payload.get("port")
            user = (payload.get("user") or "").strip()
            auth_method = payload.get("auth_method")
            selected_roles = payload.get("selected_roles") or []

            if not host or not user:
                raise HTTPException(
                    status_code=400, detail="host and user are required"
                )
            if not alias:
                alias = host
            if not selected_roles:
                raise HTTPException(
                    status_code=400, detail="selected_roles is required"
                )

            if port is not None:
                try:
                    port = int(port)
                except Exception as exc:
                    raise HTTPException(
                        status_code=400, detail=f"invalid port: {exc}"
                    ) from exc
                if port < 1 or port > 65535:
                    raise HTTPException(status_code=400, detail="port out of range")

            cleaned_roles: list[str] = []
            seen_roles: set[str] = set()
            for role_id in selected_roles:
                if not isinstance(role_id, str):
                    continue
                normalized_role_id = role_id.strip()
                if not normalized_role_id or normalized_role_id in seen_roles:
                    continue
                seen_roles.add(normalized_role_id)
                cleaned_roles.append(normalized_role_id)

            if inventory_path.exists():
                self._merge_inventory_roles(
                    root, alias=alias, selected_roles=cleaned_roles
                )
            else:
                inventory = _build_inventory(selected_roles=cleaned_roles, alias=alias)
                atomic_write_text(
                    inventory_path,
                    yaml.safe_dump(
                        inventory,
                        sort_keys=False,
                        default_flow_style=False,
                        allow_unicode=True,
                    ),
                )

            host_vars_name = _sanitize_host_filename(alias)
            host_vars_path = root / "host_vars" / f"{host_vars_name}.yml"
            atomic_write_text(
                host_vars_path,
                yaml.safe_dump(
                    {
                        "ansible_host": host,
                        "ansible_user": user,
                        **({"ansible_port": port} if port else {}),
                    },
                    sort_keys=False,
                    default_flow_style=False,
                    allow_unicode=True,
                ),
            )
            _apply_cli_host_vars_defaults(host_vars_path, host)

            if port:
                try:
                    host_vars_data = (
                        yaml.safe_load(
                            host_vars_path.read_text(encoding="utf-8", errors="replace")
                        )
                        or {}
                    )
                except Exception:
                    host_vars_data = {}
                host_vars_data["ansible_port"] = port
                atomic_write_text(
                    host_vars_path,
                    yaml.safe_dump(
                        host_vars_data,
                        sort_keys=False,
                        default_flow_style=False,
                        allow_unicode=True,
                    ),
                )

            atomic_write_text(root / "group_vars" / "all.yml", "")

            meta = _load_meta(root)
            meta.update(
                {
                    "inventory_generated_at": _now_iso(),
                    "selected_roles": list(cleaned_roles),
                    "host": host,
                    "port": port,
                    "user": user,
                    "auth_method": auth_method,
                    "host_vars_file": f"host_vars/{host_vars_name}.yml",
                    "alias": alias,
                }
            )
            _write_meta(root, meta)
            _ensure_secrets_dirs(root)
            self._history_commit(root, "bulk: inventory generation")
