from __future__ import annotations

import importlib.util
import logging
import os
import re
import sys
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Any, Callable, Dict, List, Optional, Set

import yaml

from roles.role_models import RoleGalaxyInfo, RoleLogo, RoleMetaMain, RoleMetadata


_ALLOWED_STATUSES: Set[str] = {"pre-alpha", "alpha", "beta", "stable", "deprecated"}
_TARGETS_ORDER: List[str] = ["universal", "server", "workstation"]
_TARGETS_SET: Set[str] = set(_TARGETS_ORDER)
LOGGER = logging.getLogger(__name__)


def _as_mapping(obj: Any) -> Dict[str, Any]:
    return obj if isinstance(obj, dict) else {}


def _as_list(obj: Any) -> List[Any]:
    return obj if isinstance(obj, list) else []


def _as_str(obj: Any) -> Optional[str]:
    if obj is None:
        return None
    if isinstance(obj, str):
        s = obj.strip()
        return s if s else None
    return str(obj).strip() or None


def _stable_dedup_str(items: List[str]) -> List[str]:
    seen: Set[str] = set()
    out: List[str] = []
    for x in items:
        x = x.strip()
        if not x:
            continue
        if x not in seen:
            out.append(x)
            seen.add(x)
    return out


def _normalize_status(value: Optional[str]) -> Optional[str]:
    """
    Normalize common lifecycle values to the allowed status set.

    Accepts common variants:
      - prealpha / pre-alpha / pre_alpha
      - alpha
      - beta
      - rc / release-candidate -> beta (pragmatic mapping)
      - stable / production -> stable
      - deprecated / obsolete -> deprecated
    """
    if not value:
        return None

    v = value.strip().lower()
    v = v.replace("_", "-").replace(" ", "-")

    # common aliases
    if v in {"prealpha", "pre-alpha"}:
        return "pre-alpha"
    if v in {"alpha"}:
        return "alpha"
    if v in {"beta"}:
        return "beta"
    if v in {"rc", "release-candidate", "releasecandidate"}:
        return "beta"
    if v in {"stable", "prod", "production"}:
        return "stable"
    if v in {"deprecated", "obsolete"}:
        return "deprecated"

    if v in _ALLOWED_STATUSES:
        return v
    return None


def _default_status(value: Optional[str]) -> str:
    """
    Ensures status is always present for Acceptance Criteria.
    If lifecycle is missing/unknown -> default to pre-alpha.
    """
    norm = _normalize_status(value)
    return norm if norm else "pre-alpha"


def _read_yaml(path: Path) -> Dict[str, Any]:
    if not path.is_file():
        return {}
    raw = path.read_text(encoding="utf-8", errors="replace")
    data = yaml.safe_load(raw) or {}
    return data if isinstance(data, dict) else {}


def _parse_logo(gi: Dict[str, Any]) -> Optional[RoleLogo]:
    logo = _as_mapping(gi.get("logo"))
    css_class = _as_str(logo.get("class"))
    return RoleLogo(css_class=css_class) if css_class else None


def parse_meta_main(role_dir: Path) -> RoleMetaMain:
    meta_path = role_dir / "meta" / "main.yml"
    doc = _read_yaml(meta_path)

    gi = _as_mapping(doc.get("galaxy_info"))
    galaxy_tags = [
        str(x).strip() for x in _as_list(gi.get("galaxy_tags")) if str(x).strip()
    ]
    run_after = [
        str(x).strip() for x in _as_list(gi.get("run_after")) if str(x).strip()
    ]
    platforms = _as_list(gi.get("platforms"))

    galaxy_info = RoleGalaxyInfo(
        author=_as_str(gi.get("author")),
        description=_as_str(gi.get("description")),
        license=_as_str(gi.get("license")),
        license_url=_as_str(gi.get("license_url")),
        homepage=_as_str(gi.get("homepage")),
        forum=_as_str(gi.get("forum")),
        video=_as_str(gi.get("video")),
        company=_as_str(gi.get("company")),
        galaxy_tags=_stable_dedup_str(galaxy_tags),
        repository=_as_str(gi.get("repository")),
        issue_tracker_url=_as_str(gi.get("issue_tracker_url")),
        documentation=_as_str(gi.get("documentation")),
        min_ansible_version=_as_str(gi.get("min_ansible_version")),
        platforms=platforms if isinstance(platforms, list) else [],
        lifecycle=_as_str(gi.get("lifecycle")),
        run_after=_stable_dedup_str(run_after),
        logo=_parse_logo(gi),
    )

    deps = doc.get("dependencies", [])
    dependencies: List[str] = []
    if isinstance(deps, list):
        for x in deps:
            if isinstance(x, str):
                s = x.strip()
                if s:
                    dependencies.append(s)
            elif isinstance(x, dict):
                role_name = _as_str(x.get("role")) or _as_str(x.get("name"))
                if role_name:
                    dependencies.append(role_name)

    return RoleMetaMain(
        galaxy_info=galaxy_info,
        dependencies=_stable_dedup_str(dependencies),
    )


def _extract_description_from_readme(role_dir: Path) -> Optional[str]:
    readme = role_dir / "README.md"
    if not readme.is_file():
        return None

    text = readme.read_text(encoding="utf-8", errors="replace")
    lines = [ln.rstrip() for ln in text.splitlines()]

    heading_idx: Optional[int] = None
    for i, ln in enumerate(lines):
        if re.match(r"^\s*#\s+\S+", ln):
            heading_idx = i
            break

    start = (heading_idx + 1) if heading_idx is not None else 0

    buf: List[str] = []
    in_para = False
    for ln in lines[start:]:
        if not ln.strip():
            if in_para and buf:
                break
            continue
        if not in_para and re.match(r"^\s*!\[.*\]\(.*\)\s*$", ln):
            continue
        if not in_para and re.match(r"^\s*\[!\[.*\]\(.*\)\]\(.*\)\s*$", ln):
            continue
        in_para = True
        buf.append(ln.strip())

    desc = " ".join(buf).strip()
    return desc if desc else None


def _extract_headline_from_readme(role_dir: Path) -> Optional[str]:
    readme = role_dir / "README.md"
    if not readme.is_file():
        return None

    text = readme.read_text(encoding="utf-8", errors="replace")
    for ln in text.splitlines():
        m = re.match(r"^\s*#{1,3}\s+(.+?)\s*$", ln)
        if not m:
            continue
        headline = m.group(1).strip().strip("#").strip()
        if headline:
            return headline
    return None


def _nexus_repo_path() -> Path:
    raw = (os.getenv("INFINITO_REPO_PATH", "/repo/infinito-nexus") or "").strip()
    return Path(raw or "/repo/infinito-nexus")


@lru_cache(maxsize=8)
def _load_nexus_types_from_group_names(
    repo_root: str,
) -> Callable[[List[str]], List[str]]:
    repo_path = Path(repo_root)
    invokable_py = repo_path / "module_utils" / "invokable.py"
    if not invokable_py.is_file():
        raise FileNotFoundError(f"Nexus SPOT module not found: {invokable_py}")

    # Keep Nexus repo importable for module-internal imports such as
    # `from filter_plugins.invokable_paths import ...`.
    repo_root_str = str(repo_path)
    if repo_root_str not in sys.path:
        sys.path.insert(0, repo_root_str)

    module_name = f"_infinito_nexus_invokable_{abs(hash(repo_root_str))}"
    spec = importlib.util.spec_from_file_location(module_name, invokable_py)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not create module spec for {invokable_py}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)  # type: ignore[union-attr]
    except Exception:
        sys.modules.pop(module_name, None)
        raise
    mod = module if isinstance(module, ModuleType) else None
    if mod is None:
        raise ImportError(f"Failed to load module from {invokable_py}")

    fn = getattr(mod, "types_from_group_names", None)
    if not callable(fn):
        raise AttributeError(
            "Nexus SPOT module does not export callable 'types_from_group_names'"
        )
    return fn


def _derive_deployment_targets_from_nexus(role_name: str) -> Optional[List[str]]:
    name = role_name.strip()
    if not name:
        return []

    repo_root = str(_nexus_repo_path())
    try:
        types_from_group_names = _load_nexus_types_from_group_names(repo_root)
        raw = types_from_group_names([name]) or []
    except Exception as exc:
        LOGGER.warning(
            "role %s: failed to classify deployment targets via Nexus SPOT: %s",
            name,
            exc,
        )
        return None

    valid = {str(item).strip() for item in raw if str(item).strip() in _TARGETS_SET}
    return [target for target in _TARGETS_ORDER if target in valid]


def _derive_deployment_targets(
    role_name: str, platforms: List[Dict[str, Any]]
) -> List[str]:
    spot_targets = _derive_deployment_targets_from_nexus(role_name)
    if spot_targets is not None:
        return spot_targets

    # Keep fallback minimal and non-authoritative:
    # if Nexus SPOT is unavailable, only infer "server" from Docker platforms.
    targets: Set[str] = set()
    platform_names = []
    for p in platforms:
        pm = p if isinstance(p, dict) else {}
        n = pm.get("name")
        if isinstance(n, str) and n.strip():
            platform_names.append(n.strip().lower())

    if "docker" in platform_names:
        targets.add("server")

    if not targets:
        targets.add("universal")

    return [t for t in _TARGETS_ORDER if t in targets]


def _derive_display_name(role_name: str) -> str:
    """
    Convert role ID to a human-friendly display name for UI tiles.

    Examples:
      web-app-nextcloud -> Nextcloud
      persona-provider-iam -> IAM
      sys-svc-webserver-core -> Webserver Core
    """
    s = role_name.strip()
    if not s:
        return "Unknown"

    # Remove common prefixes
    prefixes = [
        "web-app-",
        "web-svc-",
        "svc-",
        "sys-",
        "desk-",
        "drv-",
    ]
    for p in prefixes:
        if s.startswith(p):
            s = s[len(p) :]
            break

    parts = [x for x in s.split("-") if x]
    if not parts:
        return role_name

    # Preserve common acronyms
    acronyms = {
        "id",
        "api",
        "iam",
        "oidc",
        "ldap",
        "sso",
        "ssh",
        "tls",
        "dns",
        "http",
        "https",
        "sql",
    }
    out_parts: List[str] = []
    for p in parts:
        lower = p.lower()
        if lower in acronyms:
            out_parts.append(lower.upper())
        else:
            out_parts.append(lower.capitalize())

    return " ".join(out_parts)


def extract_role_metadata(role_dir: Path) -> RoleMetadata:
    role_name = role_dir.name
    meta = parse_meta_main(role_dir)

    description = (meta.galaxy_info.description or "").strip()
    if not description:
        description = (_extract_description_from_readme(role_dir) or "").strip()
    if not description:
        description = "(no description provided)"

    deployment_targets = _derive_deployment_targets(
        role_name, meta.galaxy_info.platforms
    )

    # Status (always present)
    status = _default_status(meta.galaxy_info.lifecycle)
    display_name = _extract_headline_from_readme(role_dir) or _derive_display_name(
        role_name
    )

    return RoleMetadata(
        id=role_name,
        display_name=display_name,
        role_name=role_name,
        role_path=role_dir,
        description=description,
        author=meta.galaxy_info.author,
        company=meta.galaxy_info.company,
        license=meta.galaxy_info.license,
        license_url=meta.galaxy_info.license_url,
        homepage=meta.galaxy_info.homepage,
        forum=meta.galaxy_info.forum,
        video=meta.galaxy_info.video,
        repository=meta.galaxy_info.repository,
        issue_tracker_url=meta.galaxy_info.issue_tracker_url,
        documentation=meta.galaxy_info.documentation,
        min_ansible_version=meta.galaxy_info.min_ansible_version,
        galaxy_tags=meta.galaxy_info.galaxy_tags,
        dependencies=meta.dependencies,
        lifecycle=meta.galaxy_info.lifecycle,
        run_after=meta.galaxy_info.run_after,
        platforms=meta.galaxy_info.platforms,
        logo=meta.galaxy_info.logo,
        deployment_targets=deployment_targets,
        status=status,
    )
