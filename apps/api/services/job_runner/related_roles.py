from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List

import yaml

from services.role_index import RoleIndexService

_DOMAIN_PRIMARY_PATTERN = re.compile(r"{{\s*DOMAIN_PRIMARY\s*}}")
_LOAD_APP_ID_PATTERN = re.compile(
    r"^\s*load_app_id\s*:\s*['\"]?([A-Za-z0-9_.-]+)['\"]?\s*$",
    re.MULTILINE,
)


def _as_mapping(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _iter_domain_values(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        text = value.strip()
        if text:
            yield text
        return

    if isinstance(value, list):
        for item in value:
            if isinstance(item, str):
                text = item.strip()
                if text:
                    yield text
        return

    if isinstance(value, dict):
        for item in value.values():
            if isinstance(item, str):
                text = item.strip()
                if text:
                    yield text


def _read_yaml(path: Path) -> Dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        loaded = yaml.safe_load(path.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _resolve_repo_root() -> Path | None:
    raw = (os.getenv("INFINITO_REPO_PATH") or "").strip()
    if not raw:
        return None
    repo_root = Path(raw)
    return repo_root if repo_root.is_dir() else None


def _render_domain_template(value: str, *, domain_primary: str) -> str:
    return _DOMAIN_PRIMARY_PATTERN.sub(domain_primary, value).strip()


def _resolve_role_domains(
    *,
    repo_root: Path,
    role_id: str,
    domain_primary: str,
) -> List[str]:
    config_path = repo_root / "roles" / role_id / "config" / "main.yml"
    config = _read_yaml(config_path)
    server = _as_mapping(config.get("server"))
    domains = _as_mapping(server.get("domains"))
    rendered: List[str] = []
    seen: set[str] = set()
    for raw in _iter_domain_values(domains.get("canonical")):
        value = _render_domain_template(raw, domain_primary=domain_primary)
        if not value or value in seen:
            continue
        rendered.append(value)
        seen.add(value)
    return rendered


def _discover_task_loaded_roles(*, repo_root: Path, role_id: str) -> List[str]:
    tasks_dir = repo_root / "roles" / role_id / "tasks"
    if not tasks_dir.is_dir():
        return []

    discovered: List[str] = []
    seen: set[str] = set()
    for path in sorted(tasks_dir.rglob("*.yml")):
        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue

        for match in _LOAD_APP_ID_PATTERN.finditer(content):
            candidate_id = str(match.group(1) or "").strip()
            if not candidate_id or candidate_id in seen:
                continue
            seen.add(candidate_id)
            discovered.append(candidate_id)

    return discovered


def _resolve_related_roles(
    *, selected_roles: Iterable[str], repo_root: Path
) -> List[str]:
    try:
        index = RoleIndexService()
    except Exception:
        return []

    queue: List[str] = [str(role_id).strip() for role_id in selected_roles if role_id]
    seen: set[str] = set(queue)
    related: List[str] = []

    while queue:
        role_id = queue.pop(0)
        try:
            role = index.get(role_id)
        except Exception:
            role = None

        candidates = [
            *((role.dependencies or []) if role else []),
            *((role.run_after or []) if role else []),
            *_discover_task_loaded_roles(repo_root=repo_root, role_id=role_id),
        ]
        for candidate in candidates:
            candidate_id = str(candidate or "").strip()
            if not candidate_id or candidate_id in seen:
                continue
            seen.add(candidate_id)
            related.append(candidate_id)
            queue.append(candidate_id)

    return related


def discover_related_role_domains(
    *,
    selected_roles: Iterable[str],
    domain_primary: str,
) -> Dict[str, List[str]]:
    repo_root = _resolve_repo_root()
    if repo_root is None:
        return {}

    mapping: Dict[str, List[str]] = {}
    for role_id in _resolve_related_roles(
        selected_roles=selected_roles,
        repo_root=repo_root,
    ):
        domains = _resolve_role_domains(
            repo_root=repo_root,
            role_id=role_id,
            domain_primary=domain_primary,
        )
        if domains:
            mapping[role_id] = domains
    return mapping
