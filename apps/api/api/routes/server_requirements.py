from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, Request

from api.auth import ensure_workspace_access
from api.schemas.server_requirements import (
    WorkspaceServerAliasDeleteOut,
    WorkspaceServerAliasRenameIn,
    WorkspaceServerAliasRenameOut,
    WorkspaceServerRequirementsListOut,
    WorkspaceServerRequirementsOut,
    WorkspaceServerRequirementsPutIn,
)
from services.server_requirements import WorkspaceServerRequirementsService
from services.workspaces import WorkspaceService

router = APIRouter(prefix="/workspaces", tags=["requirements"])


@lru_cache(maxsize=1)
def _workspaces() -> WorkspaceService:
    return WorkspaceService()


@lru_cache(maxsize=1)
def _svc() -> WorkspaceServerRequirementsService:
    return WorkspaceServerRequirementsService()


def _require_workspace(request: Request, workspace_id: str) -> None:
    ensure_workspace_access(request, workspace_id, _workspaces())


@router.get(
    "/{workspace_id}/server-requirements",
    response_model=WorkspaceServerRequirementsListOut,
)
def list_server_requirements(
    workspace_id: str, request: Request
) -> WorkspaceServerRequirementsListOut:
    _require_workspace(request, workspace_id)
    return WorkspaceServerRequirementsListOut(
        workspace_id=workspace_id,
        requirements_by_alias=_svc().list_requirements(workspace_id),
    )


@router.get(
    "/{workspace_id}/servers/{alias}/requirements",
    response_model=WorkspaceServerRequirementsOut,
)
def get_server_requirements(
    workspace_id: str, alias: str, request: Request
) -> WorkspaceServerRequirementsOut:
    _require_workspace(request, workspace_id)
    return WorkspaceServerRequirementsOut(
        workspace_id=workspace_id,
        alias=alias,
        requirements=_svc().get_requirements(workspace_id, alias),
    )


@router.put(
    "/{workspace_id}/servers/{alias}/requirements",
    response_model=WorkspaceServerRequirementsOut,
)
def put_server_requirements(
    workspace_id: str,
    alias: str,
    payload: WorkspaceServerRequirementsPutIn,
    request: Request,
) -> WorkspaceServerRequirementsOut:
    _require_workspace(request, workspace_id)
    stored = _svc().set_requirements(workspace_id, alias, payload.requirements)
    return WorkspaceServerRequirementsOut(
        workspace_id=workspace_id, alias=alias, requirements=stored
    )


@router.post(
    "/{workspace_id}/servers/rename",
    response_model=WorkspaceServerAliasRenameOut,
)
def rename_server_alias(
    workspace_id: str, payload: WorkspaceServerAliasRenameIn, request: Request
) -> WorkspaceServerAliasRenameOut:
    _require_workspace(request, workspace_id)
    renamed = _svc().rename_alias(workspace_id, payload.from_alias, payload.to_alias)
    return WorkspaceServerAliasRenameOut(renamed=renamed)


@router.delete(
    "/{workspace_id}/servers/{alias}/requirements",
    response_model=WorkspaceServerAliasDeleteOut,
)
def delete_server_alias(
    workspace_id: str, alias: str, request: Request
) -> WorkspaceServerAliasDeleteOut:
    _require_workspace(request, workspace_id)
    deleted = _svc().delete_alias(workspace_id, alias)
    return WorkspaceServerAliasDeleteOut(deleted=deleted)
