"""Layered loader for form fields per requirement 023.

Resolves a role's `form_fields` by merging key-by-key across three
candidate sources with first-source-wins precedence:

  1. `meta/schema.yml` (new upstream — explicit typed schema)
  2. `meta/*.yml` defaults (new upstream — inferred from default YAML)
  3. `config/main.yml` defaults (current image layout — inferred)

App-config blocks (entries carrying `image`/`ports`/`run_after`/
`version`/`name`) are excluded — they are role-internal, not
user-tunable. Field names matching `password|secret|token|api_key`
are flagged `secret=True` regardless of their inferred type.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any


from api.schemas.role import FormField, FormFieldType
from .service_links_loader import APP_CONFIG_MARKERS, _read_yaml_mapping

LOGGER = logging.getLogger(__name__)

_SECRET_NAME_PATTERN = re.compile(r"(password|secret|token|api[_-]?key)", re.IGNORECASE)

# meta/*.yml files iterated for default-source extraction. schema.yml
# is the explicit-type source and gets its own pass; services.yml is
# a service-toggle file (req-022), not a config-defaults file.
_META_DEFAULTS_FILES: tuple[str, ...] = (
    "main.yml",
    "info.yml",
    "server.yml",
    "volumes.yml",
)


def _is_app_config_block(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    return any(marker in value for marker in APP_CONFIG_MARKERS)


def _is_secret_name(name: str) -> bool:
    return _SECRET_NAME_PATTERN.search(name) is not None


def _infer_type(value: Any) -> FormFieldType:
    """Map a YAML node to a form-field type."""
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        if "\n" in value or len(value) > 120:
            return "text"
        return "string"
    if isinstance(value, list):
        return "list"
    if isinstance(value, dict):
        return "mapping"
    # null / mixed list / unknown -> safest default
    return "string"


def _label_from_path(path: list[str]) -> str:
    """Last segment, title-cased with underscores -> spaces."""
    if not path:
        return ""
    return path[-1].replace("_", " ").replace("-", " ").strip().title()


def _walk_defaults(
    prefix: list[str], data: Any, out: dict[tuple[str, ...], FormField]
) -> None:
    """Walk a mapping and emit a FormField per leaf, recursing into nested mappings.

    Keys that name an app-config block (mapping with `image`/`ports`/etc)
    are skipped entirely so the role's own internal config never surfaces.
    """
    if not isinstance(data, dict):
        return

    for raw_key, value in data.items():
        key = str(raw_key)
        path = prefix + [key]

        # Skip nested mappings that are clearly app-config blocks
        # (e.g. the `akaunting:` block carrying image/ports/run_after).
        if _is_app_config_block(value):
            continue

        # Recurse into nested mappings UNLESS the mapping is a plain
        # leaf-value (no further unfold). We unfold nested dicts to
        # individual fields so the form renders one tree view.
        if isinstance(value, dict) and value:
            _walk_defaults(path, value, out)
            continue

        secret = _is_secret_name(key)
        ftype: FormFieldType = "password" if secret else _infer_type(value)

        out[tuple(path)] = FormField(
            path=path,
            type=ftype,
            label=_label_from_path(path),
            description=None,
            default=value,
            secret=secret,
        )


def _walk_schema(
    prefix: list[str], data: Any, out: dict[tuple[str, ...], FormField]
) -> None:
    """Walk a `meta/schema.yml` mapping into FormFields.

    A leaf is recognised when the mapping's keys include any of
    `description`, `algorithm`, `validation`, `type`, `default`,
    `enum`. Anything else is treated as a section and recursed.
    """
    if not isinstance(data, dict):
        return
    schema_leaf_keys = {
        "description",
        "algorithm",
        "validation",
        "type",
        "default",
        "enum",
    }

    for raw_key, value in data.items():
        key = str(raw_key)
        path = prefix + [key]
        if not isinstance(value, dict):
            # Bare default value — treat as inferred-type field.
            secret = _is_secret_name(key)
            ftype: FormFieldType = "password" if secret else _infer_type(value)
            out[tuple(path)] = FormField(
                path=path,
                type=ftype,
                label=_label_from_path(path),
                default=value,
                secret=secret,
            )
            continue

        if value.keys() & schema_leaf_keys:
            secret = _is_secret_name(key)
            declared_type = value.get("type")
            ftype = (
                declared_type
                if isinstance(declared_type, str)
                and declared_type
                in {
                    "boolean",
                    "integer",
                    "float",
                    "string",
                    "text",
                    "list",
                    "mapping",
                    "password",
                }
                else "password"
                if secret
                else "string"
            )
            enum_value = value.get("enum")
            out[tuple(path)] = FormField(
                path=path,
                type=ftype,
                label=_label_from_path(path),
                description=value.get("description"),
                default=value.get("default"),
                enum=enum_value if isinstance(enum_value, list) else None,
                validation=(
                    value["validation"]
                    if isinstance(value.get("validation"), str)
                    else None
                ),
                secret=secret or ftype == "password",
            )
            continue

        # Section node — recurse.
        _walk_schema(path, value, out)


def _load_from_meta_schema(role_dir: Path) -> dict[tuple[str, ...], FormField]:
    data = _read_yaml_mapping(role_dir / "meta" / "schema.yml")
    out: dict[tuple[str, ...], FormField] = {}
    _walk_schema([], data, out)
    return out


def _load_from_meta_defaults(role_dir: Path) -> dict[tuple[str, ...], FormField]:
    out: dict[tuple[str, ...], FormField] = {}
    for filename in _META_DEFAULTS_FILES:
        data = _read_yaml_mapping(role_dir / "meta" / filename)
        if not data:
            continue
        # main.yml is Galaxy metadata under `galaxy_info:` — that is
        # NOT user-tunable. Strip it out.
        if filename == "main.yml" and "galaxy_info" in data:
            data = {k: v for k, v in data.items() if k != "galaxy_info"}
        _walk_defaults([], data, out)
    return out


def _load_from_config_main(role_dir: Path) -> dict[tuple[str, ...], FormField]:
    data = _read_yaml_mapping(role_dir / "config" / "main.yml")
    if not data:
        return {}
    # Drop `features:` and `services:` blocks — they are surfaced as
    # ServiceLinks via req-022, not as form fields.
    data = {k: v for k, v in data.items() if k not in ("features", "services")}
    out: dict[tuple[str, ...], FormField] = {}
    _walk_defaults([], data, out)
    return out


def load_form_fields(role_dir: Path) -> list[FormField]:
    """Resolve `form_fields` for a role with the documented precedence.

    Order (per-key first-source-wins):
      1. `meta/schema.yml`        -> explicit typed metadata
      2. `meta/*.yml` defaults    -> inferred (new upstream layout)
      3. `config/main.yml`        -> inferred (current image layout)

    Logs which sources contributed on INFO so the migration cut-over
    is observable.
    """
    role_id = role_dir.name

    schema_fields = _load_from_meta_schema(role_dir)
    meta_default_fields = _load_from_meta_defaults(role_dir)
    config_default_fields = _load_from_config_main(role_dir)

    merged: dict[tuple[str, ...], FormField] = {}
    # Lower-precedence sources first; higher-precedence overrides them.
    merged.update(config_default_fields)
    merged.update(meta_default_fields)
    merged.update(schema_fields)

    sources_used: list[str] = []
    if schema_fields:
        sources_used.append("meta-schema")
    if meta_default_fields:
        sources_used.append("meta-defaults")
    if config_default_fields:
        sources_used.append("config-main")
    if not sources_used:
        LOGGER.info("forms-loader: %s sources=none", role_id)
        return []

    LOGGER.info("forms-loader: %s sources=%s", role_id, ",".join(sources_used))

    return sorted(merged.values(), key=lambda field: ("/".join(field.path)).lower())
