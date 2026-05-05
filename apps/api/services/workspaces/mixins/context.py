from __future__ import annotations

import copy
import json
import os
import re
import sys
import uuid
from pathlib import Path
from typing import Any

import yaml
from fastapi import HTTPException

from services.job_runner.util import atomic_write_json, safe_mkdir, utc_iso
from ..paths import workspaces_root

WORKSPACE_META_FILENAME = "workspace.json"
INVENTORY_FILENAME = "inventory.yml"

_HIDDEN_FILES = {WORKSPACE_META_FILENAME, ".git"}
_LEGACY_ID_RE = re.compile(r"^[a-z0-9]{6,32}$")
_UUID4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
_ROLE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9\-_]{0,63}$")
_VAULT_BLOCK_START_RE = re.compile(r"^([ \t]*).*!vault\s*\|.*$")
_WORKSPACE_STATES = {"draft", "deployed", "finished"}


class _TaggedYamlValue:
    def __init__(self, tag: str, value: Any, style: str | None = None) -> None:
        self.tag = tag
        self.value = value
        self.style = style


class _WorkspaceYamlLoader(yaml.SafeLoader):
    pass


class _WorkspaceYamlDumper(yaml.SafeDumper):
    pass


def _construct_unknown_yaml_tag(
    loader: _WorkspaceYamlLoader, node: yaml.Node
) -> _TaggedYamlValue:
    if isinstance(node, yaml.ScalarNode):
        value = loader.construct_scalar(node)
        return _TaggedYamlValue(node.tag, value, style=node.style)
    if isinstance(node, yaml.SequenceNode):
        return _TaggedYamlValue(node.tag, loader.construct_sequence(node))
    if isinstance(node, yaml.MappingNode):
        return _TaggedYamlValue(node.tag, loader.construct_mapping(node))
    return _TaggedYamlValue(node.tag, None)


def _represent_tagged_yaml_value(
    dumper: _WorkspaceYamlDumper, data: _TaggedYamlValue
) -> yaml.Node:
    value = data.value
    if isinstance(value, dict):
        return dumper.represent_mapping(data.tag, value)
    if isinstance(value, list):
        return dumper.represent_sequence(data.tag, value)

    style = data.style
    scalar_value = str(value)
    if data.tag == "!vault":
        lines = [
            line.strip()
            for line in scalar_value.replace("\r\n", "\n").split("\n")
            if line.strip()
        ]
        scalar_value = "\n".join(lines)
        style = "|"
    return dumper.represent_scalar(data.tag, scalar_value, style=style)


_WorkspaceYamlLoader.add_constructor(None, _construct_unknown_yaml_tag)
_WorkspaceYamlDumper.add_representer(_TaggedYamlValue, _represent_tagged_yaml_value)


def load_workspace_yaml_document(raw: str) -> Any:
    loader = _WorkspaceYamlLoader(raw or "")
    try:
        return loader.get_single_data()
    finally:
        loader.dispose()


def _now_iso() -> str:
    return utc_iso()


def _ensure_workspace_root() -> None:
    safe_mkdir(workspaces_root())


def _sanitize_workspace_id(raw: str) -> str:
    workspace_id = (raw or "").strip().lower()
    if not workspace_id or not (
        _LEGACY_ID_RE.match(workspace_id) or _UUID4_RE.match(workspace_id)
    ):
        raise HTTPException(status_code=400, detail="invalid workspace id")
    return workspace_id


def _new_workspace_id() -> str:
    return str(uuid.uuid4())


def _meta_path(root: Path) -> Path:
    return root / WORKSPACE_META_FILENAME


def _load_meta(root: Path) -> dict[str, Any]:
    path = _meta_path(root)
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_meta(root: Path, data: dict[str, Any]) -> None:
    atomic_write_json(_meta_path(root), data)


def _safe_resolve(root: Path, rel_path: str) -> Path:
    raw = (rel_path or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="path required")
    if Path(raw).is_absolute():
        raise HTTPException(status_code=400, detail="invalid path")

    candidate = (root / raw).resolve()
    root_resolved = root.resolve()
    if candidate == root_resolved or root_resolved not in candidate.parents:
        raise HTTPException(status_code=400, detail="invalid path")
    if candidate.name in _HIDDEN_FILES:
        raise HTTPException(status_code=403, detail="access denied")
    return candidate


def _to_entry(root: Path, path: Path, is_dir: bool) -> dict[str, Any]:
    if path.name in _HIDDEN_FILES:
        return {}

    entry: dict[str, Any] = {
        "path": path.relative_to(root).as_posix(),
        "is_dir": is_dir,
    }
    try:
        stat = path.stat()
        if not is_dir:
            entry["size"] = int(stat.st_size)
        entry["modified_at"] = utc_iso(stat.st_mtime)
    except Exception:
        pass
    return entry


def _sanitize_host_filename(host: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", host.strip())
    return cleaned or "host"


def _build_inventory(selected_roles: list[str], alias: str) -> dict[str, Any]:
    children: dict[str, Any] = {}
    seen: set[str] = set()
    for role_id in selected_roles:
        role_name = role_id.strip()
        if not role_name or role_name in seen:
            continue
        seen.add(role_name)
        children[role_name] = {"hosts": {alias: {}}}
    return {"all": {"children": children}}


def _repo_root() -> Path:
    raw = (os.getenv("INFINITO_REPO_PATH", "") or "").strip()
    if not raw:
        raise HTTPException(status_code=500, detail="INFINITO_REPO_PATH is not set")
    root = Path(raw)
    if not root.is_dir():
        raise HTTPException(status_code=500, detail="INFINITO_REPO_PATH is invalid")
    return root


def _ip_defaults(host: str) -> tuple[str, str]:
    host = host.strip()
    ipv4 = "127.0.0.1"
    ipv6 = "::1"
    if re.match(r"^\d{1,3}(?:\.\d{1,3}){3}$", host):
        ipv4 = host
    elif ":" in host:
        ipv6 = host
    return ipv4, ipv6


def _apply_cli_host_vars_defaults(host_vars_path: Path, host: str) -> None:
    repo_root = _repo_root()
    repo_root_str = str(repo_root)
    if repo_root_str not in sys.path:
        sys.path.insert(0, repo_root_str)

    try:
        from cli.create.inventory.host_vars import ensure_host_vars_file
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"failed to load cli.create.inventory.host_vars: {exc}",
        ) from exc

    ip4, ip6 = _ip_defaults(host)
    try:
        ensure_host_vars_file(
            host_vars_file=host_vars_path,
            host=host,
            primary_domain=None,
            ssl_disabled=False,
            ip4=ip4,
            ip6=ip6,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"failed to apply host vars defaults: {exc}"
        ) from exc


def _sanitize_role_id(raw: str) -> str:
    role_id = (raw or "").strip()
    if not role_id or not _ROLE_ID_RE.match(role_id):
        raise HTTPException(status_code=400, detail="invalid role id")
    return role_id


def _load_yaml_mapping(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        loaded = load_workspace_yaml_document(
            path.read_text(encoding="utf-8", errors="replace")
        )
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail=f"invalid YAML in {path.as_posix()}: {exc}"
        ) from exc
    if loaded is None:
        return {}
    if not isinstance(loaded, dict):
        raise HTTPException(
            status_code=400,
            detail=f"YAML root must be a mapping in {path.as_posix()}",
        )
    return loaded


def _dump_yaml_mapping(data: dict[str, Any]) -> str:
    return yaml.dump(
        data,
        Dumper=_WorkspaceYamlDumper,
        sort_keys=False,
        default_flow_style=False,
        allow_unicode=True,
    )


def _dump_yaml_fragment(value: Any) -> str:
    dumped = yaml.dump(
        {} if value is None else value,
        Dumper=_WorkspaceYamlDumper,
        sort_keys=False,
        default_flow_style=False,
        allow_unicode=True,
    )
    return dumped if dumped.endswith("\n") else f"{dumped}\n"


def _merge_missing(dst: dict[str, Any], src: dict[str, Any]) -> int:
    added = 0
    for key, value in src.items():
        if key not in dst:
            dst[key] = copy.deepcopy(value)
            added += 1
            continue

        existing = dst.get(key)
        if isinstance(existing, dict) and isinstance(value, dict):
            added += _merge_missing(existing, value)
    return added


def _sanitize_workspace_state(raw: Any) -> str:
    state = str(raw or "").strip().lower()
    return state if state in _WORKSPACE_STATES else "draft"


def _workspace_last_modified_iso(root: Path) -> str:
    latest = 0.0
    try:
        latest = max(latest, root.stat().st_mtime)
    except Exception:
        pass

    for dirpath, _dirnames, filenames in os.walk(root):
        current_dir = Path(dirpath)
        try:
            latest = max(latest, current_dir.stat().st_mtime)
        except Exception:
            pass
        for filename in filenames:
            try:
                latest = max(latest, (current_dir / filename).stat().st_mtime)
            except Exception:
                pass

    return utc_iso(latest or None)
