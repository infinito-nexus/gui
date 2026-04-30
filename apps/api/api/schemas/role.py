from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel


class RoleLogoOut(BaseModel):
    # "meta" if css_class was defined in meta/main.yml
    source: str
    css_class: Optional[str] = None
    url: Optional[str] = None


class ServiceLink(BaseModel):
    # Defined per requirement 022. Top-level toggle entries from
    # meta/services.yml (new layout) or features:/services: keys in
    # config/main.yml (current image layout).
    key: str
    default_enabled: bool
    shared: bool = False


FormFieldType = Literal[
    "boolean",
    "integer",
    "float",
    "string",
    "text",
    "list",
    "mapping",
    "password",
]


class FormField(BaseModel):
    # Defined per requirement 023. Flat list, nested mappings unfold
    # to `path` of segments so the frontend renders one tree view.
    path: List[str]
    type: FormFieldType
    label: str
    description: Optional[str] = None
    default: Optional[Any] = None
    enum: Optional[List[Any]] = None
    validation: Optional[str] = None
    secret: bool = False


class RoleOut(BaseModel):
    # Required by A/C
    id: str
    display_name: str
    status: str  # always present (pre-alpha/alpha/beta/stable/deprecated)

    # Existing
    role_name: str
    description: str

    author: Optional[str] = None
    company: Optional[str] = None
    license: Optional[str] = None
    license_url: Optional[str] = None
    homepage: Optional[str] = None
    forum: Optional[str] = None
    video: Optional[str] = None
    repository: Optional[str] = None
    issue_tracker_url: Optional[str] = None
    documentation: Optional[str] = None
    min_ansible_version: Optional[str] = None

    galaxy_tags: List[str] = []
    dependencies: List[str] = []
    lifecycle: Optional[str] = None
    run_after: List[str] = []
    platforms: List[Dict[str, Any]] = []
    logo: Optional[RoleLogoOut] = None

    deployment_targets: List[str] = []

    # Optional categories from roles/categories.yml (if available)
    categories: List[str] = []
    bundle_member: bool = False

    # Optional pricing metadata (schema-driven)
    pricing_summary: Optional[Dict[str, Any]] = None
    pricing: Optional[Dict[str, Any]] = None

    # Per requirement 022 — connected platform-services exposed as
    # toggles in the role-detail modal's Services tab. Empty list when
    # the role provides no services.yml / config/main.yml entries.
    services_links: List[ServiceLink] = []

    # Per requirement 023 — typed configuration fields exposed in the
    # role-detail modal's Forms tab. Empty list when the role exposes
    # no user-tunable config (only app-config blocks like image/ports).
    form_fields: List[FormField] = []
