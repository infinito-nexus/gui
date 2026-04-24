from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


AuditLogMode = Literal[
    "all",
    "writes-only",
    "auth-only",
    "deployment-only",
    "errors-only",
]
AuditLogExportFormat = Literal["jsonl", "csv"]


class AuditLogConfigIn(BaseModel):
    retention_days: int = Field(default=180, ge=1, le=3650)
    mode: AuditLogMode = "all"
    exclude_health_endpoints: bool = False


class AuditLogConfigOut(AuditLogConfigIn):
    workspace_id: str


class AuditLogEntryOut(BaseModel):
    id: int
    timestamp: str
    workspace_id: str | None = None
    user: str
    method: str
    path: str
    status: int
    duration_ms: int
    ip: str
    request_id: str | None = None
    user_agent: str | None = None


class AuditLogEntryListOut(BaseModel):
    entries: list[AuditLogEntryOut]
    page: int
    page_size: int
    total: int
