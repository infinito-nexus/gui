from __future__ import annotations

from functools import lru_cache

from fastapi import HTTPException, Request

from api.auth import (
    ensure_workspace_access,
    ensure_workspace_list_allowed,
    resolve_auth_context,
)
from api.schemas.workspace import (
    WorkspaceCreateOut,
    WorkspaceDeleteOut,
    WorkspaceGenerateIn,
    WorkspaceGenerateOut,
    WorkspaceListOut,
    WorkspaceMemberDeleteOut,
    WorkspaceMemberInviteIn,
    WorkspaceMemberOut,
    WorkspaceMembersOut,
    WorkspaceTransferOwnershipIn,
    WorkspaceTransferOwnershipOut,
)
from services.role_index.service import RoleIndexService
from .workspaces import _require_workspace, _svc, router


def _require_workspace_owner(request: Request, workspace_id: str) -> str:
    """Authorise the request as workspace owner.

    Raises 403 (not 404) when the caller has access but is not the owner —
    the workspace's existence is no longer secret to them at that point.
    """
    ctx = ensure_workspace_access(request, workspace_id, _svc())
    meta = _svc()._meta_with_members(_svc().ensure(workspace_id))
    actor = (ctx.user_id or "").strip() or None
    owner = str(meta.get("owner_id") or "").strip() or None
    if not actor or actor != owner:
        raise HTTPException(status_code=403, detail="owner-only operation")
    return actor


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


# ---- req 019 — workspace RBAC members API -------------------------------


@router.get("/{workspace_id}/members", response_model=WorkspaceMembersOut)
def list_members(workspace_id: str, request: Request) -> WorkspaceMembersOut:
    _require_workspace(request, workspace_id)
    payload = _svc().list_members(workspace_id)
    return WorkspaceMembersOut(
        owner=WorkspaceMemberOut(**payload["owner"]),
        members=[WorkspaceMemberOut(**m) for m in payload["members"]],
        pending=[WorkspaceMemberOut(**m) for m in payload["pending"]],
    )


@router.post("/{workspace_id}/members", response_model=WorkspaceMemberOut)
def invite_member(
    workspace_id: str, body: WorkspaceMemberInviteIn, request: Request
) -> WorkspaceMemberOut:
    invited_by = _require_workspace_owner(request, workspace_id)
    entry = _svc().invite_member(workspace_id, invited_by=invited_by, email=body.email)
    return WorkspaceMemberOut(**entry)


@router.delete(
    "/{workspace_id}/members/{member_key}",
    response_model=WorkspaceMemberDeleteOut,
)
def remove_member(
    workspace_id: str, member_key: str, request: Request
) -> WorkspaceMemberDeleteOut:
    _require_workspace_owner(request, workspace_id)
    _svc().remove_member(workspace_id, member_key)
    return WorkspaceMemberDeleteOut(ok=True)


@router.post(
    "/{workspace_id}/members/transfer-ownership",
    response_model=WorkspaceTransferOwnershipOut,
)
def transfer_ownership(
    workspace_id: str, body: WorkspaceTransferOwnershipIn, request: Request
) -> WorkspaceTransferOwnershipOut:
    _require_workspace_owner(request, workspace_id)
    result = _svc().transfer_ownership(workspace_id, new_owner_id=body.new_owner_id)
    return WorkspaceTransferOwnershipOut(**result)
