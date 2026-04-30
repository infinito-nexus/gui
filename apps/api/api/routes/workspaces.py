from __future__ import annotations

import importlib
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import StreamingResponse

from api.auth import ensure_workspace_access
from api.schemas.workspace import (
    WorkspaceConnectionTestIn,
    WorkspaceConnectionTestOut,
    WorkspaceCredentialsIn,
    WorkspaceCredentialsOut,
    WorkspaceDirCreateOut,
    WorkspaceFileDeleteOut,
    WorkspaceFileListOut,
    WorkspaceFileOut,
    WorkspaceFileRenameIn,
    WorkspaceFileRenameOut,
    WorkspaceFileWriteIn,
    WorkspaceKeyPassphraseIn,
    WorkspaceMasterPasswordIn,
    WorkspaceRoleAppConfigImportOut,
    WorkspaceRoleAppConfigIn,
    WorkspaceRoleAppConfigOut,
    WorkspaceRoleAppFieldPatchIn,
    WorkspaceRoleAppFieldPatchOut,
    WorkspaceRuntimeSettingsIn,
    WorkspaceRuntimeSettingsOut,
    WorkspaceServerConnectionIn,
    WorkspaceServerConnectionOut,
    WorkspaceSshKeygenIn,
    WorkspaceSshKeygenOut,
    WorkspaceUploadPreviewOut,
    WorkspaceUploadOut,
    WorkspaceVaultChangeIn,
    WorkspaceVaultDecryptIn,
    WorkspaceVaultDecryptOut,
    WorkspaceVaultEncryptIn,
    WorkspaceVaultEncryptOut,
    WorkspaceVaultEntryIn,
    WorkspaceVaultEntryOut,
    WorkspaceVaultPasswordResetIn,
    WorkspaceVaultPasswordResetOut,
)
from services.role_index.service import RoleIndexService
from services.rate_limits import RateLimitService
from services.workspaces import WorkspaceService
from .workspaces_zip_utils import ensure_zip_upload, parse_upload_modes

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@lru_cache(maxsize=1)
def _svc() -> WorkspaceService:
    return WorkspaceService()


@lru_cache(maxsize=1)
def _roles() -> RoleIndexService:
    return RoleIndexService()


def _require_workspace(request: Request, workspace_id: str) -> None:
    ensure_workspace_access(request, workspace_id, _svc())


def _require_known_role(role_id: str) -> str:
    known = _roles().get(role_id)
    return known.id


def _require_known_roles(role_ids: list[str] | None) -> list[str]:
    return [_require_known_role(role_id) for role_id in role_ids or []]


def _rate_limits(request: Request) -> RateLimitService:
    return getattr(request.app.state, "rate_limits", None) or RateLimitService()


@router.get("/{workspace_id}/files", response_model=WorkspaceFileListOut)
def list_files(workspace_id: str, request: Request) -> WorkspaceFileListOut:
    _require_workspace(request, workspace_id)
    return WorkspaceFileListOut(files=_svc().list_files(workspace_id))


@router.get(
    "/{workspace_id}/runtime-settings", response_model=WorkspaceRuntimeSettingsOut
)
def get_runtime_settings(
    workspace_id: str, request: Request
) -> WorkspaceRuntimeSettingsOut:
    _require_workspace(request, workspace_id)
    data = _svc().get_runtime_settings(workspace_id)
    return WorkspaceRuntimeSettingsOut(**data)


@router.put(
    "/{workspace_id}/runtime-settings", response_model=WorkspaceRuntimeSettingsOut
)
def update_runtime_settings(
    workspace_id: str, payload: WorkspaceRuntimeSettingsIn, request: Request
) -> WorkspaceRuntimeSettingsOut:
    _require_workspace(request, workspace_id)
    data = _svc().update_runtime_settings(
        workspace_id,
        infinito_nexus_version=payload.infinito_nexus_version,
    )
    return WorkspaceRuntimeSettingsOut(**data)


@router.get("/{workspace_id}/download/{path:path}")
def download_file(workspace_id: str, path: str, request: Request) -> StreamingResponse:
    _require_workspace(request, workspace_id)
    data = _svc().read_file_bytes(workspace_id, path)
    filename = Path(path).name or "file"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(
        iter([data]),
        media_type="application/octet-stream",
        headers=headers,
    )


@router.get("/{workspace_id}/files/{path:path}", response_model=WorkspaceFileOut)
def read_file(workspace_id: str, path: str, request: Request) -> WorkspaceFileOut:
    _require_workspace(request, workspace_id)
    content = _svc().read_file(workspace_id, path)
    return WorkspaceFileOut(path=path, content=content)


@router.put("/{workspace_id}/files/{path:path}", response_model=WorkspaceFileOut)
def write_file(
    workspace_id: str, path: str, payload: WorkspaceFileWriteIn, request: Request
) -> WorkspaceFileOut:
    _require_workspace(request, workspace_id)
    _svc().write_file(workspace_id, path, payload.content)
    return WorkspaceFileOut(path=path, content=payload.content)


@router.get(
    "/{workspace_id}/roles/{role_id}/app-config",
    response_model=WorkspaceRoleAppConfigOut,
)
def read_role_app_config(
    workspace_id: str, role_id: str, request: Request, alias: str | None = None
) -> WorkspaceRoleAppConfigOut:
    _require_workspace(request, workspace_id)
    _require_known_role(role_id)
    data = _svc().read_role_app_config(
        workspace_id=workspace_id,
        role_id=role_id,
        alias=alias,
    )
    return WorkspaceRoleAppConfigOut(**data)


@router.put(
    "/{workspace_id}/roles/{role_id}/app-config",
    response_model=WorkspaceRoleAppConfigOut,
)
def write_role_app_config(
    workspace_id: str,
    role_id: str,
    payload: WorkspaceRoleAppConfigIn,
    request: Request,
    alias: str | None = None,
) -> WorkspaceRoleAppConfigOut:
    _require_workspace(request, workspace_id)
    _require_known_role(role_id)
    data = _svc().write_role_app_config(
        workspace_id=workspace_id,
        role_id=role_id,
        alias=alias,
        content=payload.content,
    )
    return WorkspaceRoleAppConfigOut(**data)


@router.patch(
    "/{workspace_id}/roles/{role_id}/app-config/field",
    response_model=WorkspaceRoleAppFieldPatchOut,
)
def patch_role_app_field(
    workspace_id: str,
    role_id: str,
    payload: WorkspaceRoleAppFieldPatchIn,
    request: Request,
) -> WorkspaceRoleAppFieldPatchOut:
    """Per-field PATCH for the Forms tab (req-023).

    Sets or deletes a single key under
    `host_vars/<alias>.yml.applications.<role-id>.<path>`. When
    `payload.alias` is null, writes to `group_vars/all.yml` instead.
    """
    _require_workspace(request, workspace_id)
    _require_known_role(role_id)
    data = _svc().patch_role_app_field(
        workspace_id=workspace_id,
        role_id=role_id,
        alias=payload.alias,
        path=payload.path,
        value=payload.value,
        delete=payload.delete,
    )
    return WorkspaceRoleAppFieldPatchOut(**data)


@router.post(
    "/{workspace_id}/roles/{role_id}/app-config/import-defaults",
    response_model=WorkspaceRoleAppConfigImportOut,
)
def import_role_app_defaults(
    workspace_id: str, role_id: str, request: Request, alias: str | None = None
) -> WorkspaceRoleAppConfigImportOut:
    _require_workspace(request, workspace_id)
    _require_known_role(role_id)
    data = _svc().import_role_app_defaults(
        workspace_id=workspace_id,
        role_id=role_id,
        alias=alias,
    )
    return WorkspaceRoleAppConfigImportOut(**data)


@router.post(
    "/{workspace_id}/files/{path:path}/rename",
    response_model=WorkspaceFileRenameOut,
)
def rename_file(
    workspace_id: str, path: str, payload: WorkspaceFileRenameIn, request: Request
) -> WorkspaceFileRenameOut:
    _require_workspace(request, workspace_id)
    new_path = _svc().rename_file(workspace_id, path, payload.new_path)
    return WorkspaceFileRenameOut(path=new_path)


@router.post(
    "/{workspace_id}/files/{path:path}/mkdir",
    response_model=WorkspaceDirCreateOut,
)
def create_dir(workspace_id: str, path: str, request: Request) -> WorkspaceDirCreateOut:
    _require_workspace(request, workspace_id)
    new_path = _svc().create_dir(workspace_id, path)
    return WorkspaceDirCreateOut(path=new_path)


@router.delete(
    "/{workspace_id}/files/{path:path}", response_model=WorkspaceFileDeleteOut
)
def delete_file(
    workspace_id: str, path: str, request: Request
) -> WorkspaceFileDeleteOut:
    _require_workspace(request, workspace_id)
    _svc().delete_file(workspace_id, path)
    return WorkspaceFileDeleteOut(ok=True)


@router.post("/{workspace_id}/credentials", response_model=WorkspaceCredentialsOut)
def generate_credentials(
    workspace_id: str, payload: WorkspaceCredentialsIn, request: Request
) -> WorkspaceCredentialsOut:
    _require_workspace(request, workspace_id)
    _require_known_roles(payload.selected_roles)
    _svc().generate_credentials(
        workspace_id=workspace_id,
        master_password=payload.master_password,
        selected_roles=payload.selected_roles,
        allow_empty_plain=payload.allow_empty_plain,
        set_values=payload.set_values,
        force=payload.force,
        alias=payload.alias,
    )
    return WorkspaceCredentialsOut(ok=True)


@router.post("/{workspace_id}/vault/entries", response_model=WorkspaceVaultEntryOut)
def set_vault_entries(
    workspace_id: str, payload: WorkspaceVaultEntryIn, request: Request
) -> WorkspaceVaultEntryOut:
    _require_workspace(request, workspace_id)
    _svc().set_vault_entries(
        workspace_id=workspace_id,
        master_password=payload.master_password,
        master_password_confirm=payload.master_password_confirm,
        create_if_missing=payload.create_if_missing,
        alias=payload.alias,
        server_password=payload.server_password,
        vault_password=payload.vault_password,
        key_passphrase=payload.key_passphrase,
    )
    return WorkspaceVaultEntryOut(ok=True)


@router.post(
    "/{workspace_id}/vault/change-master", response_model=WorkspaceVaultEntryOut
)
def change_vault_master(
    workspace_id: str, payload: WorkspaceVaultChangeIn, request: Request
) -> WorkspaceVaultEntryOut:
    _require_workspace(request, workspace_id)
    _svc().set_or_reset_vault_master_password(
        workspace_id=workspace_id,
        current_master_password=payload.master_password,
        new_master_password=payload.new_master_password,
        new_master_password_confirm=payload.new_master_password_confirm,
    )
    return WorkspaceVaultEntryOut(ok=True)


@router.post(
    "/{workspace_id}/vault/master-password", response_model=WorkspaceVaultEntryOut
)
def set_or_reset_vault_master(
    workspace_id: str, payload: WorkspaceMasterPasswordIn, request: Request
) -> WorkspaceVaultEntryOut:
    _require_workspace(request, workspace_id)
    _svc().set_or_reset_vault_master_password(
        workspace_id=workspace_id,
        current_master_password=payload.current_master_password,
        new_master_password=payload.new_master_password,
        new_master_password_confirm=payload.new_master_password_confirm,
    )
    return WorkspaceVaultEntryOut(ok=True)


@router.post(
    "/{workspace_id}/vault/reset-password",
    response_model=WorkspaceVaultPasswordResetOut,
)
def reset_vault_password(
    workspace_id: str, payload: WorkspaceVaultPasswordResetIn, request: Request
) -> WorkspaceVaultPasswordResetOut:
    _require_workspace(request, workspace_id)
    result = _svc().reset_vault_password(
        workspace_id=workspace_id,
        master_password=payload.master_password,
        new_vault_password=payload.new_vault_password,
    )
    return WorkspaceVaultPasswordResetOut(ok=True, **result)


@router.post("/{workspace_id}/vault/decrypt", response_model=WorkspaceVaultDecryptOut)
def decrypt_vault(
    workspace_id: str, payload: WorkspaceVaultDecryptIn, request: Request
) -> WorkspaceVaultDecryptOut:
    _require_workspace(request, workspace_id)
    plaintext = _svc().vault_decrypt(
        workspace_id=workspace_id,
        master_password=payload.master_password,
        vault_text=payload.vault_text,
    )
    return WorkspaceVaultDecryptOut(plaintext=plaintext)


@router.post("/{workspace_id}/vault/encrypt", response_model=WorkspaceVaultEncryptOut)
def encrypt_vault(
    workspace_id: str, payload: WorkspaceVaultEncryptIn, request: Request
) -> WorkspaceVaultEncryptOut:
    _require_workspace(request, workspace_id)
    vault_text = _svc().vault_encrypt(
        workspace_id=workspace_id,
        master_password=payload.master_password,
        plaintext=payload.plaintext,
    )
    return WorkspaceVaultEncryptOut(vault_text=vault_text)


@router.post("/{workspace_id}/ssh-keys", response_model=WorkspaceSshKeygenOut)
def generate_ssh_keys(
    workspace_id: str, payload: WorkspaceSshKeygenIn, request: Request
) -> WorkspaceSshKeygenOut:
    _require_workspace(request, workspace_id)
    data = _svc().generate_ssh_keypair(
        workspace_id=workspace_id,
        alias=payload.alias,
        algorithm=payload.algorithm,
        with_passphrase=payload.with_passphrase,
        master_password=payload.master_password,
        master_password_confirm=payload.master_password_confirm,
        return_passphrase=payload.return_passphrase,
    )
    return WorkspaceSshKeygenOut(**data)


@router.post(
    "/{workspace_id}/ssh-keys/change-passphrase",
    response_model=WorkspaceVaultEntryOut,
)
def change_key_passphrase(
    workspace_id: str, payload: WorkspaceKeyPassphraseIn, request: Request
) -> WorkspaceVaultEntryOut:
    _require_workspace(request, workspace_id)
    _svc().change_key_passphrase(
        workspace_id=workspace_id,
        alias=payload.alias,
        master_password=payload.master_password,
        new_passphrase=payload.new_passphrase,
        new_passphrase_confirm=payload.new_passphrase_confirm,
    )
    return WorkspaceVaultEntryOut(ok=True)


@router.post(
    "/{workspace_id}/test-connection", response_model=WorkspaceConnectionTestOut
)
def test_connection(
    workspace_id: str, payload: WorkspaceConnectionTestIn, request: Request
) -> WorkspaceConnectionTestOut:
    _require_workspace(request, workspace_id)
    _rate_limits(request).enforce_test_connection(request, workspace_id)
    data = _svc().test_connection(
        host=payload.host,
        port=payload.port,
        user=payload.user,
        auth_method=payload.auth_method,
        password=payload.password,
        private_key=payload.private_key,
        key_passphrase=payload.key_passphrase,
    )
    return WorkspaceConnectionTestOut(**data)


@router.put(
    "/{workspace_id}/servers/{alias}/connection",
    response_model=WorkspaceServerConnectionOut,
)
def set_server_connection(
    workspace_id: str,
    alias: str,
    payload: WorkspaceServerConnectionIn,
    request: Request,
) -> WorkspaceServerConnectionOut:
    _require_workspace(request, workspace_id)
    data = _svc().upsert_server_connection(
        workspace_id=workspace_id,
        alias=alias,
        host=payload.host,
        user=payload.user,
        port=payload.port,
    )
    return WorkspaceServerConnectionOut(workspace_id=workspace_id, **data)


@router.get("/{workspace_id}/download.zip")
def download_zip(workspace_id: str, request: Request) -> StreamingResponse:
    _require_workspace(request, workspace_id)
    data = _svc().build_zip(workspace_id)
    headers = {
        "Content-Disposition": f'attachment; filename="workspace-{workspace_id}.zip"'
    }
    return StreamingResponse(
        iter([data]),
        media_type="application/zip",
        headers=headers,
    )


@router.post(
    "/{workspace_id}/upload.zip/preview",
    response_model=WorkspaceUploadPreviewOut,
)
async def upload_zip_preview(
    workspace_id: str, request: Request, file: UploadFile = File(...)
) -> WorkspaceUploadPreviewOut:
    _require_workspace(request, workspace_id)
    ensure_zip_upload(file)
    data = await file.read()
    entries = _svc().list_zip_entries(data)
    existing_paths = {
        str(item.get("path") or "")
        for item in _svc().list_files(workspace_id)
        if not bool(item.get("is_dir"))
    }
    files = [{"path": path, "exists": path in existing_paths} for path in entries]
    return WorkspaceUploadPreviewOut(files=files)


@router.post("/{workspace_id}/upload.zip", response_model=WorkspaceUploadOut)
async def upload_zip(
    workspace_id: str,
    request: Request,
    file: UploadFile = File(...),
    default_mode: str = Form("override"),
    per_file_mode_json: str | None = Form(default=None),
) -> WorkspaceUploadOut:
    _require_workspace(request, workspace_id)
    ensure_zip_upload(file)
    mode_default, per_file_mode = parse_upload_modes(default_mode, per_file_mode_json)

    data = await file.read()
    summary = _svc().load_zip(
        workspace_id,
        data,
        default_mode=mode_default,
        per_file_mode=per_file_mode,
    )
    return WorkspaceUploadOut(ok=True, files=_svc().list_files(workspace_id), **summary)


importlib.import_module(".workspaces_history_routes", __package__)
importlib.import_module(".workspaces_management_routes", __package__)
