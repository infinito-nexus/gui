from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Optional

from fastapi import HTTPException, Request

if TYPE_CHECKING:
    from services.workspaces import WorkspaceService


ADMIN_GROUP = "administrator"


def _env_flag(name: str, default: bool = False) -> bool:
    raw = (os.getenv(name, "") or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class AuthContext:
    proxy_enabled: bool
    user_id: Optional[str] = None
    email: Optional[str] = None
    groups: tuple[str, ...] = field(default_factory=tuple)

    @property
    def authenticated(self) -> bool:
        return bool(self.user_id)

    @property
    def is_administrator(self) -> bool:
        # Dev-mode bypass: when the proxy isn't wired but
        # AUTH_DEV_ADMIN=true and a user_id is present, treat the
        # local user as admin. Useful for testing the admin UI
        # without provisioning an oauth2-proxy in dev.
        if not self.proxy_enabled and self.user_id and _env_flag("AUTH_DEV_ADMIN"):
            return True
        return ADMIN_GROUP in self.groups


def _parse_groups(raw: str) -> tuple[str, ...]:
    seen: set[str] = set()
    out: list[str] = []
    for item in (raw or "").replace(";", ",").split(","):
        cleaned = item.strip().lower()
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            out.append(cleaned)
    return tuple(out)


def resolve_auth_context(request: Request) -> AuthContext:
    proxy_enabled = _env_flag("AUTH_PROXY_ENABLED", default=False)
    if not proxy_enabled:
        # Dev-mode: optionally honor a local username header so a
        # browser session simulating "logged in" can carry through to
        # `is_administrator`. Production deployments use the proxy.
        dev_user_header = (os.getenv("AUTH_DEV_USER_HEADER", "") or "").strip()
        dev_user_id: Optional[str] = None
        if dev_user_header:
            dev_user_id = (request.headers.get(dev_user_header) or "").strip() or None
        return AuthContext(
            proxy_enabled=False,
            user_id=dev_user_id,
            email=None,
            groups=tuple(),
        )

    user_header = (os.getenv("AUTH_PROXY_USER_HEADER", "") or "").strip()
    if not user_header:
        user_header = "X-Auth-Request-User"
    email_header = (os.getenv("AUTH_PROXY_EMAIL_HEADER", "") or "").strip()
    if not email_header:
        email_header = "X-Auth-Request-Email"
    groups_header = (os.getenv("AUTH_PROXY_GROUPS_HEADER", "") or "").strip()
    if not groups_header:
        groups_header = "X-Auth-Request-Groups"

    user_id = (request.headers.get(user_header) or "").strip() or None
    email = (request.headers.get(email_header) or "").strip() or None
    groups = _parse_groups(request.headers.get(groups_header) or "")
    return AuthContext(
        proxy_enabled=True,
        user_id=user_id,
        email=email,
        groups=groups,
    )


def workspace_list_policy() -> str:
    raw = (os.getenv("WORKSPACE_LIST_UNAUTH_MODE", "") or "").strip().lower()
    if raw in {"401", "unauthorized"}:
        return "401"
    return "empty"


def ensure_workspace_access(
    request: Request, workspace_id: str, svc: "WorkspaceService"
) -> AuthContext:
    ctx = resolve_auth_context(request)
    request.state.audit_workspace_id = (workspace_id or "").strip() or None
    # Email is forwarded so claim-on-access can match a pending invite
    # against `X-Auth-Request-Email` (req 019).
    svc.assert_workspace_access(workspace_id, ctx.user_id, email=ctx.email)
    return ctx


def ensure_workspace_list_allowed(request: Request) -> AuthContext:
    ctx = resolve_auth_context(request)
    if ctx.user_id:
        return ctx
    if workspace_list_policy() == "401":
        raise HTTPException(status_code=401, detail="authentication required")
    return ctx
