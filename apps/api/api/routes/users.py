from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, HTTPException, Query, Request

from api.auth import ensure_workspace_access
from api.schemas.users import (
    UserActionOut,
    UserCreateIn,
    UserListOut,
    UserOut,
    UserPasswordIn,
    UserRolesIn,
    UsersStatusOut,
)
from services.users import UsersService
from services.workspaces import WorkspaceService

router = APIRouter(prefix="/users", tags=["users"])


@lru_cache(maxsize=1)
def _users() -> UsersService:
    return UsersService()


@lru_cache(maxsize=1)
def _workspaces() -> WorkspaceService:
    return WorkspaceService()


@router.get("/status", response_model=UsersStatusOut)
def users_status(
    request: Request,
    workspace_id: str = Query(..., min_length=1),
) -> UsersStatusOut:
    ensure_workspace_access(request, workspace_id, _workspaces())
    return UsersStatusOut(**_users().eligibility(workspace_id))


@router.get("", response_model=UserListOut)
def list_users(
    request: Request,
    workspace_id: str = Query(..., min_length=1),
    server_id: str = Query(..., min_length=1),
) -> UserListOut:
    ensure_workspace_access(request, workspace_id, _workspaces())
    users = _users().list_users(workspace_id, server_id)
    return UserListOut(users=[UserOut(**item) for item in users])


@router.post("", response_model=UserActionOut)
def create_user(payload: UserCreateIn, request: Request) -> UserActionOut:
    ensure_workspace_access(request, payload.workspace_id, _workspaces())
    _users().create_user(
        payload.workspace_id,
        payload.server_id,
        username=payload.username,
        firstname=payload.firstname,
        lastname=payload.lastname,
        email=payload.email,
        password=payload.password,
        roles=payload.roles,
        enabled=payload.enabled,
    )
    return UserActionOut(ok=True)


@router.put("/{username}/password", response_model=UserActionOut)
def change_password(
    username: str,
    payload: UserPasswordIn,
    request: Request,
) -> UserActionOut:
    ensure_workspace_access(request, payload.workspace_id, _workspaces())
    if payload.new_password != payload.new_password_confirm:
        raise HTTPException(status_code=400, detail="password confirmation mismatch")
    _users().change_password(
        payload.workspace_id,
        payload.server_id,
        username=username,
        new_password=payload.new_password,
    )
    return UserActionOut(ok=True)


@router.put("/{username}/roles", response_model=UserActionOut)
def update_roles(
    username: str, payload: UserRolesIn, request: Request
) -> UserActionOut:
    ensure_workspace_access(request, payload.workspace_id, _workspaces())
    _users().update_roles(
        payload.workspace_id,
        payload.server_id,
        username=username,
        roles=payload.roles,
        enabled=payload.enabled,
    )
    return UserActionOut(ok=True)


@router.delete("/{username}", response_model=UserActionOut)
def delete_user(
    request: Request,
    username: str,
    workspace_id: str = Query(..., min_length=1),
    server_id: str = Query(..., min_length=1),
) -> UserActionOut:
    ensure_workspace_access(request, workspace_id, _workspaces())
    _users().delete_user(workspace_id, server_id, username=username)
    return UserActionOut(ok=True)
