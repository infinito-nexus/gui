from __future__ import annotations

from functools import lru_cache

from fastapi import Request

from api.auth import (
    ensure_workspace_list_allowed,
    resolve_auth_context,
)
from api.schemas.workspace import (
    WorkspaceCreateOut,
    WorkspaceDeleteOut,
    WorkspaceGenerateIn,
    WorkspaceGenerateOut,
    WorkspaceListOut,
)
from services.role_index.service import RoleIndexService
from .workspaces import _require_workspace, _svc, router


@lru_cache(maxsize=1)
def _roles() -> RoleIndexService:
    return RoleIndexService()


def _require_known_roles(role_ids: list[str]) -> None:
    for role_id in role_ids or []:
        _roles().get(role_id)


@router.get("", response_model=WorkspaceListOut)
def list_workspaces(request: Request) -> WorkspaceListOut:
    ctx = ensure_workspace_list_allowed(request)
    if not ctx.user_id:
        return WorkspaceListOut(authenticated=False, user_id=None, workspaces=[])
    return WorkspaceListOut(
        authenticated=True,
        user_id=ctx.user_id,
        workspaces=_svc().list_for_user(ctx.user_id),
    )


@router.post("", response_model=WorkspaceCreateOut)
def create_workspace(request: Request) -> WorkspaceCreateOut:
    ctx = resolve_auth_context(request)
    meta = _svc().create(owner_id=ctx.user_id, owner_email=ctx.email)
    return WorkspaceCreateOut(
        workspace_id=meta.get("workspace_id"),
        created_at=meta.get("created_at"),
    )


@router.delete("/{workspace_id}", response_model=WorkspaceDeleteOut)
def delete_workspace(workspace_id: str, request: Request) -> WorkspaceDeleteOut:
    _require_workspace(request, workspace_id)
    _svc().delete(workspace_id)
    return WorkspaceDeleteOut(ok=True)


@router.post("/{workspace_id}/generate-inventory", response_model=WorkspaceGenerateOut)
def generate_inventory(
    workspace_id: str, req: WorkspaceGenerateIn, request: Request
) -> WorkspaceGenerateOut:
    _require_workspace(request, workspace_id)
    _require_known_roles(list(req.selected_roles or []))
    _svc().generate_inventory(workspace_id, req.model_dump())
    files = _svc().list_files(workspace_id)
    return WorkspaceGenerateOut(
        workspace_id=workspace_id,
        inventory_path="inventory.yml",
        files=files,
        warnings=[],
    )
