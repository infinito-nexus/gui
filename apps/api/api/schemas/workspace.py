from __future__ import annotations

from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from api.schemas.deployment import AuthMethod, ROLE_ID_RE


def _normalize_role_ids(values: list[str] | None) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        if not isinstance(value, str):
            continue
        role_id = value.strip()
        if not role_id:
            continue
        if not ROLE_ID_RE.match(role_id):
            raise ValueError(
                "selected_roles entries must match ^[a-z0-9][a-z0-9\\-_]{0,63}$"
            )
        if role_id not in seen:
            cleaned.append(role_id)
            seen.add(role_id)
    return cleaned


class WorkspaceCreateOut(BaseModel):
    workspace_id: str
    created_at: Optional[str] = None


class WorkspaceListEntryOut(BaseModel):
    workspace_id: str
    name: str
    created_at: Optional[str] = None
    last_modified_at: Optional[str] = None
    state: str = "draft"


class WorkspaceListEntryOutWithRole(WorkspaceListEntryOut):
    role: str = "owner"


class WorkspaceListOut(BaseModel):
    authenticated: bool = False
    user_id: Optional[str] = None
    workspaces: List[WorkspaceListEntryOutWithRole] = Field(default_factory=list)


class WorkspaceDeleteOut(BaseModel):
    ok: bool


# req 019 — workspace RBAC: owner + member memberships.
class WorkspaceMemberOut(BaseModel):
    user_id: Optional[str] = None
    email: Optional[str] = None
    role: str = "member"
    joined_at: Optional[str] = None
    invited_at: Optional[str] = None
    invited_by: Optional[str] = None


class WorkspaceMembersOut(BaseModel):
    owner: WorkspaceMemberOut
    members: List[WorkspaceMemberOut] = Field(default_factory=list)
    pending: List[WorkspaceMemberOut] = Field(default_factory=list)


class WorkspaceMemberInviteIn(BaseModel):
    email: str = Field(..., min_length=3, description="Email address to invite")


class WorkspaceMemberDeleteOut(BaseModel):
    ok: bool


class WorkspaceTransferOwnershipIn(BaseModel):
    new_owner_id: str = Field(..., min_length=1)


class WorkspaceTransferOwnershipOut(BaseModel):
    ok: bool
    new_owner_id: str
    previous_owner_id: str


class WorkspaceRuntimeSettingsIn(BaseModel):
    infinito_nexus_version: str = Field(default="latest", min_length=1)


class WorkspaceRuntimeSettingsOut(BaseModel):
    infinito_nexus_version: str = "latest"


class WorkspaceGenerateIn(BaseModel):
    alias: Optional[str] = Field(
        default=None, min_length=1, description="Inventory host alias"
    )
    host: str = Field(..., min_length=1, description="localhost / IP / domain")
    port: Optional[int] = Field(default=None, ge=1, le=65535)
    user: str = Field(..., min_length=1, description="SSH user")
    auth_method: Optional[AuthMethod] = None
    selected_roles: List[str] = Field(default_factory=list)

    @field_validator("selected_roles")
    @classmethod
    def _clean_selected_roles(cls, values: List[str]) -> List[str]:
        return _normalize_role_ids(values)


class WorkspaceFileEntry(BaseModel):
    path: str
    is_dir: bool
    size: Optional[int] = None
    modified_at: Optional[str] = None


class WorkspaceFileListOut(BaseModel):
    files: List[WorkspaceFileEntry]


class WorkspaceFileOut(BaseModel):
    path: str
    content: str


class WorkspaceFileWriteIn(BaseModel):
    content: str


class WorkspaceHistoryFileChangeOut(BaseModel):
    status: str
    path: str
    old_path: Optional[str] = None


class WorkspaceHistoryEntryOut(BaseModel):
    sha: str
    created_at: Optional[str] = None
    summary: str
    files: List[WorkspaceHistoryFileChangeOut] = Field(default_factory=list)


class WorkspaceHistoryListOut(BaseModel):
    commits: List[WorkspaceHistoryEntryOut] = Field(default_factory=list)


class WorkspaceHistoryDiffOut(BaseModel):
    sha: str
    path: Optional[str] = None
    against_current: bool = False
    files: List[WorkspaceHistoryFileChangeOut] = Field(default_factory=list)
    diff: str = ""


class WorkspaceHistoryRestoreFileIn(BaseModel):
    path: str = Field(..., min_length=1)


class WorkspaceHistoryRestoreOut(BaseModel):
    ok: bool
    sha: str
    path: Optional[str] = None


class WorkspaceRoleAppConfigIn(BaseModel):
    content: str = Field(default="", description="YAML mapping for applications.<role>")


class WorkspaceRoleAppConfigOut(BaseModel):
    role_id: str
    alias: str
    host_vars_path: str
    content: str


class WorkspaceRoleAppConfigImportOut(WorkspaceRoleAppConfigOut):
    imported_paths: int = 0


class WorkspaceRoleAppFieldPatchIn(BaseModel):
    """PATCH input for the per-field config endpoint (req-023).

    `path` is a non-empty list of segments (e.g. ["company", "name"]).
    `value` is the new value to write at that path. Set `delete=True`
    to remove the key instead — when deleting, `value` is ignored.
    `alias` is optional; when omitted the write goes to
    `group_vars/all.yml` instead of a per-host `host_vars/<alias>.yml`.
    """

    path: List[str] = Field(..., min_length=1)
    value: Any = None
    delete: bool = False
    alias: Optional[str] = None


class WorkspaceRoleAppFieldPatchOut(WorkspaceRoleAppConfigOut):
    path: List[str]
    deleted: bool


class WorkspaceFileRenameIn(BaseModel):
    new_path: str = Field(..., min_length=1)


class WorkspaceFileDeleteOut(BaseModel):
    ok: bool


class WorkspaceFileRenameOut(BaseModel):
    path: str


class WorkspaceDirCreateOut(BaseModel):
    path: str


class WorkspaceGenerateOut(BaseModel):
    workspace_id: str
    inventory_path: str
    files: List[WorkspaceFileEntry]
    warnings: List[str] = Field(default_factory=list)


class WorkspaceUploadPreviewFile(BaseModel):
    path: str
    exists: bool = False


class WorkspaceUploadPreviewOut(BaseModel):
    files: List[WorkspaceUploadPreviewFile] = Field(default_factory=list)


class WorkspaceUploadOut(BaseModel):
    ok: bool
    files: List[WorkspaceFileEntry]
    created_files: int = 0
    overridden_files: int = 0
    merged_files: int = 0
    skipped_files: int = 0


class WorkspaceCredentialsIn(BaseModel):
    master_password: str = Field(..., min_length=1)
    selected_roles: Optional[List[str]] = None
    allow_empty_plain: bool = False
    set_values: Optional[List[str]] = None
    force: bool = False
    alias: Optional[str] = Field(
        default=None, min_length=1, description="Inventory host alias"
    )

    @field_validator("selected_roles")
    @classmethod
    def _clean_selected_roles(cls, values: Optional[List[str]]) -> Optional[List[str]]:
        if values is None:
            return None
        return _normalize_role_ids(values)


class WorkspaceCredentialsOut(BaseModel):
    ok: bool


class WorkspaceVaultEntryIn(BaseModel):
    master_password: str = Field(..., min_length=1)
    master_password_confirm: Optional[str] = None
    create_if_missing: bool = True
    alias: Optional[str] = Field(default=None, min_length=1)
    server_password: Optional[str] = None
    vault_password: Optional[str] = None
    key_passphrase: Optional[str] = None


class WorkspaceVaultEntryOut(BaseModel):
    ok: bool


class WorkspaceVaultChangeIn(BaseModel):
    master_password: str = Field(..., min_length=1)
    new_master_password: str = Field(..., min_length=1)
    new_master_password_confirm: str = Field(..., min_length=1)


class WorkspaceMasterPasswordIn(BaseModel):
    current_master_password: Optional[str] = None
    new_master_password: str = Field(..., min_length=1)
    new_master_password_confirm: str = Field(..., min_length=1)


class WorkspaceVaultPasswordResetIn(BaseModel):
    master_password: str = Field(..., min_length=1)
    new_vault_password: Optional[str] = None


class WorkspaceVaultPasswordResetOut(BaseModel):
    ok: bool
    updated_files: int = 0
    updated_values: int = 0


class WorkspaceVaultDecryptIn(BaseModel):
    master_password: str = Field(..., min_length=1)
    vault_text: str = Field(..., min_length=1)


class WorkspaceVaultDecryptOut(BaseModel):
    plaintext: str


class WorkspaceVaultEncryptIn(BaseModel):
    master_password: str = Field(..., min_length=1)
    plaintext: str = Field(..., min_length=0)


class WorkspaceVaultEncryptOut(BaseModel):
    vault_text: str


class WorkspaceSshKeygenIn(BaseModel):
    alias: str = Field(..., min_length=1)
    algorithm: str = Field(default="ed25519", min_length=1)
    with_passphrase: bool = False
    master_password: Optional[str] = None
    master_password_confirm: Optional[str] = None
    return_passphrase: bool = False


class WorkspaceSshKeygenOut(BaseModel):
    private_key: str
    public_key: str
    key_path: str
    public_key_path: str
    passphrase: Optional[str] = None


class WorkspaceKeyPassphraseIn(BaseModel):
    alias: str = Field(..., min_length=1)
    master_password: str = Field(..., min_length=1)
    new_passphrase: str = Field(..., min_length=0)
    new_passphrase_confirm: str = Field(..., min_length=0)


class WorkspaceConnectionTestIn(BaseModel):
    host: str = Field(..., min_length=1)
    port: Optional[int] = Field(default=None, ge=1, le=65535)
    user: str = Field(..., min_length=1)
    auth_method: AuthMethod
    password: Optional[str] = None
    private_key: Optional[str] = None
    key_passphrase: Optional[str] = None


class WorkspaceConnectionTestOut(BaseModel):
    ping_ok: bool
    ping_error: Optional[str] = None
    ssh_ok: bool
    ssh_error: Optional[str] = None


class WorkspaceServerConnectionIn(BaseModel):
    host: str = Field(..., min_length=1)
    user: str = Field(..., min_length=1)
    port: Optional[int] = Field(default=None, ge=1, le=65535)


class WorkspaceServerConnectionOut(BaseModel):
    workspace_id: str
    alias: str
    host_vars_path: str
    host: str
    user: str
    port: Optional[int] = None
