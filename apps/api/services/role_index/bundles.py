from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, List, Set


@dataclass(frozen=True)
class BundleInventory:
    id: str
    slug: str
    deploy_target: str
    title: str
    description: str
    logo_class: str | None = None
    tags: List[str] = field(default_factory=list)
    categories: List[str] = field(default_factory=list)
    role_ids: List[str] = field(default_factory=list)


def bundles_root_path() -> Path:
    repo_root = os.getenv("INFINITO_REPO_PATH", "/repo/infinito-nexus")
    return Path(repo_root) / "inventories" / "bundles"


def _iter_bundle_inventory_files(root: Path) -> Iterable[Path]:
    if not root.is_dir():
        return []
    return sorted(root.rglob("inventory.yml"))


def bundles_mtime() -> int:
    root = bundles_root_path()
    mtimes = []
    try:
        mtimes.append(int(root.stat().st_mtime))
    except Exception:
        pass
    for path in _iter_bundle_inventory_files(root):
        try:
            mtimes.append(int(path.stat().st_mtime))
        except Exception:
            continue
    return max(mtimes) if mtimes else 0


def load_bundle_role_ids() -> Set[str]:
    root = bundles_root_path()
    if not root.is_dir():
        return set()

    try:
        import yaml
    except Exception:
        return set()

    role_ids: Set[str] = set()
    for inventory_path in _iter_bundle_inventory_files(root):
        try:
            raw = inventory_path.read_text(encoding="utf-8", errors="replace")
            data = yaml.safe_load(raw)
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        all_map = data.get("all")
        if not isinstance(all_map, dict):
            continue
        children = all_map.get("children")
        if not isinstance(children, dict):
            continue
        for role_id in children.keys():
            rid = str(role_id or "").strip()
            if rid:
                role_ids.add(rid)

    return role_ids


def _normalize_target(raw: str) -> str:
    token = str(raw or "").strip().lower()
    if token in {"server", "servers"}:
        return "server"
    if token in {"workstation", "workstations"}:
        return "workstation"
    return token or "server"


def _as_string_list(value: object) -> List[str]:
    if not isinstance(value, list):
        return []
    out: List[str] = []
    for entry in value:
        text = str(entry or "").strip()
        if text and text not in out:
            out.append(text)
    return out


def load_bundle_inventories() -> List[BundleInventory]:
    root = bundles_root_path()
    if not root.is_dir():
        return []

    try:
        import yaml
    except Exception:
        return []

    bundles: List[BundleInventory] = []
    for inventory_path in _iter_bundle_inventory_files(root):
        try:
            rel_parts = inventory_path.relative_to(root).parts
        except Exception:
            continue
        if len(rel_parts) < 3:
            # Expected: <target>/<slug>/inventory.yml
            continue

        deploy_target = _normalize_target(rel_parts[0])
        slug = str(rel_parts[1] or "").strip()
        if not slug:
            continue

        try:
            raw = inventory_path.read_text(encoding="utf-8", errors="replace")
            data = yaml.safe_load(raw)
        except Exception:
            continue
        if not isinstance(data, dict):
            continue

        all_map = data.get("all")
        if not isinstance(all_map, dict):
            continue
        vars_map = all_map.get("vars")
        if not isinstance(vars_map, dict):
            vars_map = {}
        infinito_map = vars_map.get("infinito")
        if not isinstance(infinito_map, dict):
            infinito_map = {}
        bundle_map = infinito_map.get("bundle")
        if not isinstance(bundle_map, dict):
            bundle_map = {}

        title = (
            str(bundle_map.get("title") or "").strip() or slug.replace("-", " ").title()
        )
        description = str(bundle_map.get("description") or "").strip()
        logo_map = bundle_map.get("logo")
        logo_class = (
            str(logo_map.get("class") or "").strip()
            if isinstance(logo_map, dict)
            else None
        )
        if logo_class == "":
            logo_class = None

        children = all_map.get("children")
        role_ids = []
        if isinstance(children, dict):
            role_ids = sorted(
                {
                    str(role_id or "").strip()
                    for role_id in children.keys()
                    if str(role_id or "").strip()
                }
            )

        bundles.append(
            BundleInventory(
                id=f"{deploy_target}/{slug}",
                slug=slug,
                deploy_target=deploy_target,
                title=title,
                description=description,
                logo_class=logo_class,
                tags=_as_string_list(bundle_map.get("tags")),
                categories=_as_string_list(bundle_map.get("categories")),
                role_ids=role_ids,
            )
        )

    bundles.sort(key=lambda item: (item.title.lower(), item.id.lower()))
    return bundles
