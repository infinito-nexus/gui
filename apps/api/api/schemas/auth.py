from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class AuthMeOut(BaseModel):
    """Snapshot of the caller's auth context for frontend gating."""

    authenticated: bool = False
    user_id: Optional[str] = None
    email: Optional[str] = None
    groups: List[str] = Field(default_factory=list)
    is_administrator: bool = False
    proxy_enabled: bool = False
