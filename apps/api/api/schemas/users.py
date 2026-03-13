from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class UsersStatusOut(BaseModel):
    can_manage: bool = False
    setup_completed: bool = False
    ldap_present: bool = False
    keycloak_servers: List[str] = Field(default_factory=list)
    reachable_servers: List[str] = Field(default_factory=list)
    reasons: List[str] = Field(default_factory=list)


class UserOut(BaseModel):
    username: str
    firstname: str = ""
    lastname: str = ""
    email: str = ""
    roles: List[str] = Field(default_factory=list)
    enabled: bool = True
    updated_at: Optional[str] = None


class UserListOut(BaseModel):
    users: List[UserOut] = Field(default_factory=list)


class UserCreateIn(BaseModel):
    workspace_id: str = Field(..., min_length=1)
    server_id: str = Field(..., min_length=1)
    username: str = Field(..., min_length=1)
    firstname: str = ""
    lastname: str = ""
    email: str = ""
    password: str = Field(..., min_length=1)
    roles: List[str] = Field(default_factory=list)
    enabled: bool = True

    @field_validator(
        "workspace_id", "server_id", "username", "firstname", "lastname", "email"
    )
    @classmethod
    def _strip_fields(cls, value: str) -> str:
        return value.strip()


class UserPasswordIn(BaseModel):
    workspace_id: str = Field(..., min_length=1)
    server_id: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=1)
    new_password_confirm: str = Field(..., min_length=1)

    @field_validator("workspace_id", "server_id")
    @classmethod
    def _strip_workspace_fields(cls, value: str) -> str:
        return value.strip()


class UserRolesIn(BaseModel):
    workspace_id: str = Field(..., min_length=1)
    server_id: str = Field(..., min_length=1)
    roles: List[str] = Field(default_factory=list)
    enabled: Optional[bool] = None

    @field_validator("workspace_id", "server_id")
    @classmethod
    def _strip_role_fields(cls, value: str) -> str:
        return value.strip()


class UserActionOut(BaseModel):
    ok: bool = True
