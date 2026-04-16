from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class InfinitoNexusVersionOptionOut(BaseModel):
    value: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    git_tag: Optional[str] = None


class InfinitoNexusVersionsOut(BaseModel):
    default_version: str = "latest"
    versions: List[InfinitoNexusVersionOptionOut] = Field(default_factory=list)
