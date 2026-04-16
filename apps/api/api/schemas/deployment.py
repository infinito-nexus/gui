from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


AuthMethod = Literal["password", "private_key"]


class DeploymentAuth(BaseModel):
    """
    Exactly one authentication method must be provided.
    If method=password    -> password must be present, private_key must be absent
    If method=private_key -> private_key must be present, password must be absent
    """

    method: AuthMethod

    # Secrets (never echoed back in responses)
    password: Optional[str] = Field(default=None, min_length=1)
    private_key: Optional[str] = Field(default=None, min_length=1)
    passphrase: Optional[str] = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _validate_auth(self) -> "DeploymentAuth":
        if self.method == "password":
            if not self.password:
                raise ValueError("auth.password is required when auth.method=password")
            if self.private_key:
                raise ValueError(
                    "auth.private_key must not be set when auth.method=password"
                )
            if self.passphrase:
                raise ValueError(
                    "auth.passphrase must not be set when auth.method=password"
                )

        if self.method == "private_key":
            if not self.private_key:
                raise ValueError(
                    "auth.private_key is required when auth.method=private_key"
                )
            if self.password:
                raise ValueError(
                    "auth.password must not be set when auth.method=private_key"
                )

        return self


class DeploymentRequest(BaseModel):
    workspace_id: str = Field(
        ..., min_length=1, description="Workspace ID (inventory source)"
    )
    host: str = Field(..., min_length=1, description="localhost / IP / domain")
    port: Optional[int] = Field(default=None, ge=1, le=65535)
    user: str = Field(..., min_length=1, description="SSH user")
    auth: DeploymentAuth
    master_password: Optional[str] = Field(
        default=None,
        min_length=1,
        description="Optional workspace vault master password for encrypted inventory values",
    )
    infinito_nexus_version: Optional[str] = Field(
        default=None,
        min_length=1,
        description="Optional Infinito.Nexus version selector (latest or stable semver)",
    )
    limit: Optional[str] = Field(
        default=None, description="Optional Ansible --limit (inventory alias)"
    )

    selected_roles: List[str] = Field(
        default_factory=list, description="List of role IDs (must not be empty)"
    )

    @field_validator("workspace_id", "host", "user")
    @classmethod
    def _strip_required(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            raise ValueError("must not be empty")
        return s

    @field_validator("limit", "master_password", "infinito_nexus_version")
    @classmethod
    def _strip_optional_string(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        s = v.strip()
        return s or None

    @field_validator("selected_roles")
    @classmethod
    def _clean_and_require_roles(cls, v: List[str]) -> List[str]:
        out: List[str] = []
        seen: set[str] = set()

        for x in v or []:
            if not isinstance(x, str):
                continue
            s = x.strip()
            if not s:
                continue
            if s not in seen:
                out.append(s)
                seen.add(s)

        if not out:
            raise ValueError("must not be empty")

        return out


class InventoryPreviewOut(BaseModel):
    inventory_yaml: str
    warnings: List[str] = Field(default_factory=list)
