from __future__ import annotations

import os
from dataclasses import dataclass
from typing import TYPE_CHECKING, Optional

from fastapi import HTTPException, Request

if TYPE_CHECKING:
    from services.workspaces import WorkspaceService


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


def resolve_auth_context(request: Request) -> AuthContext:
    proxy_enabled = _env_flag("AUTH_PROXY_ENABLED", default=False)
    if not proxy_enabled:
        return AuthContext(proxy_enabled=False, user_id=None, email=None)

    user_header = (os.getenv("AUTH_PROXY_USER_HEADER", "") or "").strip()
    if not user_header:
        user_header = "X-Auth-Request-User"
    email_header = (os.getenv("AUTH_PROXY_EMAIL_HEADER", "") or "").strip()
    if not email_header:
        email_header = "X-Auth-Request-Email"

    user_id = (request.headers.get(user_header) or "").strip() or None
    email = (request.headers.get(email_header) or "").strip() or None
    return AuthContext(proxy_enabled=True, user_id=user_id, email=email)


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
    svc.assert_workspace_access(workspace_id, ctx.user_id)
    return ctx


def ensure_workspace_list_allowed(request: Request) -> AuthContext:
    ctx = resolve_auth_context(request)
    if ctx.user_id:
        return ctx
    if workspace_list_policy() == "401":
        raise HTTPException(status_code=401, detail="authentication required")
    return ctx
