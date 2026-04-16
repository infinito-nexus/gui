from __future__ import annotations

from fastapi import Request

from api.schemas.workspace import (
    WorkspaceHistoryDiffOut,
    WorkspaceHistoryEntryOut,
    WorkspaceHistoryListOut,
    WorkspaceHistoryRestoreFileIn,
    WorkspaceHistoryRestoreOut,
)

from .workspaces import _require_workspace, _svc, router


@router.get("/{workspace_id}/history", response_model=WorkspaceHistoryListOut)
def list_history(
    workspace_id: str,
    request: Request,
    path: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> WorkspaceHistoryListOut:
    _require_workspace(request, workspace_id)
    commits = _svc().list_history(
        workspace_id,
        path=path,
        limit=limit,
        offset=offset,
    )
    return WorkspaceHistoryListOut(
        commits=[WorkspaceHistoryEntryOut(**item) for item in commits]
    )


@router.get("/{workspace_id}/history/{sha}", response_model=WorkspaceHistoryEntryOut)
def get_history_commit(
    workspace_id: str,
    sha: str,
    request: Request,
    path: str | None = None,
) -> WorkspaceHistoryEntryOut:
    _require_workspace(request, workspace_id)
    data = _svc().get_history_commit(workspace_id, sha, path=path)
    return WorkspaceHistoryEntryOut(**data)


@router.get(
    "/{workspace_id}/history/{sha}/diff", response_model=WorkspaceHistoryDiffOut
)
def get_history_diff(
    workspace_id: str,
    sha: str,
    request: Request,
    path: str | None = None,
    against_current: bool = False,
) -> WorkspaceHistoryDiffOut:
    _require_workspace(request, workspace_id)
    data = _svc().get_history_diff(
        workspace_id,
        sha,
        path=path,
        against_current=against_current,
    )
    return WorkspaceHistoryDiffOut(**data)


@router.post(
    "/{workspace_id}/history/{sha}/restore", response_model=WorkspaceHistoryRestoreOut
)
def restore_history_workspace(
    workspace_id: str, sha: str, request: Request
) -> WorkspaceHistoryRestoreOut:
    _require_workspace(request, workspace_id)
    data = _svc().restore_history_workspace(workspace_id, sha)
    return WorkspaceHistoryRestoreOut(**data)


@router.post(
    "/{workspace_id}/history/{sha}/restore-file",
    response_model=WorkspaceHistoryRestoreOut,
)
def restore_history_file(
    workspace_id: str,
    sha: str,
    payload: WorkspaceHistoryRestoreFileIn,
    request: Request,
) -> WorkspaceHistoryRestoreOut:
    _require_workspace(request, workspace_id)
    data = _svc().restore_history_path(workspace_id, sha, payload.path)
    return WorkspaceHistoryRestoreOut(**data)
