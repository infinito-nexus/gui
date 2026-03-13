from __future__ import annotations

from typing import Any, Dict

from pydantic import BaseModel, Field, field_validator


class WorkspaceServerRequirementsPutIn(BaseModel):
    requirements: Dict[str, Any] = Field(default_factory=dict)


class WorkspaceServerRequirementsOut(BaseModel):
    workspace_id: str
    alias: str
    requirements: Dict[str, Any] = Field(default_factory=dict)


class WorkspaceServerRequirementsListOut(BaseModel):
    workspace_id: str
    requirements_by_alias: Dict[str, Dict[str, Any]] = Field(default_factory=dict)


class WorkspaceServerAliasRenameIn(BaseModel):
    from_alias: str = Field(..., min_length=1)
    to_alias: str = Field(..., min_length=1)

    @field_validator("from_alias", "to_alias")
    @classmethod
    def _strip(cls, value: str) -> str:
        return str(value or "").strip()


class WorkspaceServerAliasRenameOut(BaseModel):
    ok: bool = True
    renamed: bool


class WorkspaceServerAliasDeleteOut(BaseModel):
    ok: bool = True
    deleted: bool

