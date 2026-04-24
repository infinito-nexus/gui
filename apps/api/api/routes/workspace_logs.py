from __future__ import annotations

from datetime import datetime
from functools import lru_cache

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from api.auth import ensure_workspace_access
from api.schemas.audit_logs import (
    AuditLogConfigIn,
    AuditLogConfigOut,
    AuditLogEntryListOut,
)
from services.audit_logs import AuditLogService
from services.workspaces import WorkspaceService

router = APIRouter(prefix="/workspaces", tags=["workspace-logs"])


@lru_cache(maxsize=1)
def _logs() -> AuditLogService:
    return AuditLogService()


@lru_cache(maxsize=1)
def _workspaces() -> WorkspaceService:
    return WorkspaceService()


def _require_workspace(request: Request, workspace_id: str) -> None:
    ensure_workspace_access(request, workspace_id, _workspaces())


@router.get("/{workspace_id}/logs/config", response_model=AuditLogConfigOut)
def get_workspace_log_config(workspace_id: str, request: Request) -> AuditLogConfigOut:
    _require_workspace(request, workspace_id)
    return AuditLogConfigOut(**_logs().get_config(workspace_id).as_dict())


@router.put("/{workspace_id}/logs/config", response_model=AuditLogConfigOut)
def update_workspace_log_config(
    workspace_id: str, payload: AuditLogConfigIn, request: Request
) -> AuditLogConfigOut:
    _require_workspace(request, workspace_id)
    config = _logs().update_config(
        workspace_id,
        retention_days=payload.retention_days,
        mode=payload.mode,
        exclude_health_endpoints=payload.exclude_health_endpoints,
    )
    return AuditLogConfigOut(**config.as_dict())


@router.get("/{workspace_id}/logs/entries", response_model=AuditLogEntryListOut)
def list_workspace_log_entries(
    workspace_id: str,
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    from_ts: datetime | None = Query(default=None, alias="from"),
    to_ts: datetime | None = Query(default=None, alias="to"),
    user: str | None = Query(default=None),
    ip: str | None = Query(default=None),
    q: str | None = Query(default=None),
    status: int | None = Query(default=None),
    method: str | None = Query(default=None),
) -> AuditLogEntryListOut:
    _require_workspace(request, workspace_id)
    return AuditLogEntryListOut(
        **_logs().list_entries(
            workspace_id,
            page=page,
            page_size=page_size,
            from_ts=from_ts,
            to_ts=to_ts,
            user=user,
            ip=ip,
            q=q,
            status=status,
            method=method,
        )
    )


@router.get("/{workspace_id}/logs/entries/export")
def export_workspace_log_entries(
    workspace_id: str,
    request: Request,
    format: str = Query(default="jsonl"),
    zip: bool = Query(default=False),
    from_ts: datetime | None = Query(default=None, alias="from"),
    to_ts: datetime | None = Query(default=None, alias="to"),
    user: str | None = Query(default=None),
    ip: str | None = Query(default=None),
    q: str | None = Query(default=None),
    status: int | None = Query(default=None),
    method: str | None = Query(default=None),
) -> StreamingResponse:
    _require_workspace(request, workspace_id)
    result = _logs().stream_export_entries(
        workspace_id,
        fmt=format,
        zipped=zip,
        from_ts=from_ts,
        to_ts=to_ts,
        user=user,
        ip=ip,
        q=q,
        status=status,
        method=method,
    )
    return StreamingResponse(
        content=result["body"],
        media_type=result["media_type"],
        headers={"Content-Disposition": f'attachment; filename="{result["filename"]}"'},
    )
