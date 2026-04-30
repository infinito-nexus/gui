"""Layered loader for connected-service toggles per requirement 022.

Resolves a role's `services_links` from the first source that yields
at least one toggle entry, walking the precedence chain
`meta/services.yml` (new upstream layout) -> `config/main.yml`
(current image layout). Both source layouts are normalised to the
same `ServiceLink` shape so the API and the web layer are
layout-agnostic.

When a role provides BOTH sources, `meta/services.yml` wins —
this is the migration cut-over rule. The classifier excludes
app-config blocks (entries carrying `image`/`ports`/`run_after`/
`version`/`name`) so internal role config never leaks into the
Services tab.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

from api.schemas.role import ServiceLink

LOGGER = logging.getLogger(__name__)

# Keys that mark a value as an internal app-config block, NOT a
# user-facing service toggle. Mirrors the classification rule in
# requirement 022.
APP_CONFIG_MARKERS: frozenset[str] = frozenset(
    {"image", "ports", "run_after", "version", "name"}
)


def _is_app_config_block(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    return any(marker in value for marker in APP_CONFIG_MARKERS)


def _read_yaml_mapping(path: Path) -> dict[str, Any]:
    """Read a YAML file into a dict; warn + return {} on any problem."""
    if not path.is_file():
        return {}
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
        data = yaml.safe_load(raw)
    except Exception as exc:  # pragma: no cover - defensive
        LOGGER.warning("services-loader: failed to read %s: %s", path, exc)
        return {}
    if not isinstance(data, dict):
        if data is not None:
            LOGGER.warning(
                "services-loader: %s is not a mapping; treating as empty", path
            )
        return {}
    return data


def _toggle_from_meta_entry(key: str, value: Any) -> ServiceLink | None:
    """Classify a `meta/services.yml` entry as a toggle or skip."""
    if not isinstance(value, dict):
        return None
    if "enabled" not in value:
        return None
    if _is_app_config_block(value):
        return None
    enabled = value.get("enabled")
    if not isinstance(enabled, bool):
        return None
    shared = value.get("shared", False)
    return ServiceLink(
        key=str(key),
        default_enabled=enabled,
        shared=bool(shared) if isinstance(shared, bool) else False,
    )


def _toggle_from_config_entry(key: str, value: Any) -> ServiceLink | None:
    """Classify a `config/main.yml` entry as a toggle or skip.

    Accepts both the bare-boolean form (`matomo: true`) and the
    mapping-with-`enabled` form (`matomo: { enabled: true, shared: true }`).
    """
    if isinstance(value, bool):
        return ServiceLink(key=str(key), default_enabled=value, shared=False)
    if isinstance(value, dict):
        if _is_app_config_block(value):
            return None
        if "enabled" in value and isinstance(value["enabled"], bool):
            shared = value.get("shared", False)
            return ServiceLink(
                key=str(key),
                default_enabled=value["enabled"],
                shared=bool(shared) if isinstance(shared, bool) else False,
            )
    return None


def _load_from_meta_services(role_dir: Path) -> list[ServiceLink]:
    data = _read_yaml_mapping(role_dir / "meta" / "services.yml")
    out: list[ServiceLink] = []
    for key, value in data.items():
        link = _toggle_from_meta_entry(str(key), value)
        if link is not None:
            out.append(link)
        elif isinstance(value, dict) and not _is_app_config_block(value):
            LOGGER.warning(
                "services-loader: meta/services.yml key %r in %s is not a "
                "valid toggle (missing or non-bool `enabled`); skipping",
                key,
                role_dir.name,
            )
    return out


def _merge_old_layout_sections(
    features: dict[str, Any], services: dict[str, Any]
) -> list[ServiceLink]:
    """Merge `features:` and `services:` blocks from `config/main.yml`.

    `services:` wins on key collision because it is the more
    recent of the two old-layout names.
    """
    merged: dict[str, ServiceLink] = {}

    for key, value in features.items():
        link = _toggle_from_config_entry(str(key), value)
        if link is not None:
            merged[link.key] = link
        elif value is not None and not isinstance(value, (bool, dict)):
            LOGGER.warning(
                "services-loader: features.%s value type %s is not supported; skipping",
                key,
                type(value).__name__,
            )

    for key, value in services.items():
        link = _toggle_from_config_entry(str(key), value)
        if link is not None:
            merged[link.key] = link
        elif value is not None and not isinstance(value, (bool, dict)):
            LOGGER.warning(
                "services-loader: services.%s value type %s is not supported; skipping",
                key,
                type(value).__name__,
            )

    return list(merged.values())


def _load_from_config_main(role_dir: Path) -> list[ServiceLink]:
    data = _read_yaml_mapping(role_dir / "config" / "main.yml")
    if not data:
        return []

    features = data.get("features") or {}
    services = data.get("services") or {}
    if not isinstance(features, dict):
        LOGGER.warning(
            "services-loader: config/main.yml `features` in %s is not a "
            "mapping; ignoring",
            role_dir.name,
        )
        features = {}
    if not isinstance(services, dict):
        LOGGER.warning(
            "services-loader: config/main.yml `services` in %s is not a "
            "mapping; ignoring",
            role_dir.name,
        )
        services = {}

    return _merge_old_layout_sections(features, services)


def load_service_links(role_dir: Path) -> list[ServiceLink]:
    """Resolve `services_links` for a role with the documented precedence.

    Order:
      1. `meta/services.yml` (new upstream layout)
      2. `config/main.yml` (current image layout)

    First source that yields at least one toggle wins. Logs the
    chosen source on INFO so the migration cut-over is observable.
    """
    role_id = role_dir.name

    meta_links = _load_from_meta_services(role_dir)
    if meta_links:
        LOGGER.info("services-loader: %s source=meta-services", role_id)
        return sorted(meta_links, key=lambda link: link.key)

    config_links = _load_from_config_main(role_dir)
    if config_links:
        LOGGER.info("services-loader: %s source=config-main", role_id)
        return sorted(config_links, key=lambda link: link.key)

    LOGGER.info("services-loader: %s source=none", role_id)
    return []
