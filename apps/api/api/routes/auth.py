from __future__ import annotations

from fastapi import APIRouter, Request

from api.auth import resolve_auth_context
from api.schemas.auth import AuthMeOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me", response_model=AuthMeOut)
def auth_me(request: Request) -> AuthMeOut:
    """Return the caller's auth snapshot for frontend gating.

    Always 200; anonymous callers get `authenticated=false` and no
    groups. The frontend uses this to decide whether to show
    admin-only controls.
    """
    ctx = resolve_auth_context(request)
    return AuthMeOut(
        authenticated=ctx.authenticated,
        user_id=ctx.user_id,
        email=ctx.email,
        groups=list(ctx.groups),
        is_administrator=ctx.is_administrator,
        proxy_enabled=ctx.proxy_enabled,
    )
