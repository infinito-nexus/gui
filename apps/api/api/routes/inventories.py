from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, Request

from api.auth import ensure_workspace_access
from api.schemas.deployment import DeploymentRequest, InventoryPreviewOut
from services.inventory_preview import build_inventory_preview
from services.role_index.service import RoleIndexService
from services.workspaces import WorkspaceService

router = APIRouter(prefix="/inventories", tags=["inventories"])

_workspaces = WorkspaceService()


@lru_cache(maxsize=1)
def _roles() -> RoleIndexService:
    return RoleIndexService()


def _require_known_roles(role_ids: list[str]) -> None:
    for role_id in role_ids or []:
        _roles().get(role_id)


@router.post("/preview", response_model=InventoryPreviewOut)
def preview_inventory(req: DeploymentRequest, request: Request) -> InventoryPreviewOut:
    """
    Generate an inventory YAML preview for a deployment request.

    Security:
      - Secrets are never returned (password/private key are masked or replaced by placeholders).
      - Do not log request bodies.
    """
    ensure_workspace_access(request, req.workspace_id, _workspaces)
    _require_known_roles(list(req.selected_roles or []))
    inv_yaml, warnings = build_inventory_preview(req)
    return InventoryPreviewOut(inventory_yaml=inv_yaml, warnings=warnings)
