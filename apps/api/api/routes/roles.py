from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Query

from api.schemas.role import RoleOut
from services.role_index import RoleIndexService, RoleQuery

router = APIRouter(prefix="/roles", tags=["roles"])

_index = RoleIndexService()


def _build_query(
    *,
    status: Optional[str],
    deploy_target: Optional[str],
    category: Optional[str],
    tags: Optional[str],
    q: Optional[str],
) -> RoleQuery:
    return RoleQuery.from_raw(
        status=status,
        deploy_target=deploy_target,
        category=category,
        tags=tags,
        q=q,
    )


@router.get("", response_model=List[RoleOut])
def list_roles(
    status: Optional[str] = Query(
        default=None,
        description="Comma-separated statuses. Allowed: pre-alpha,alpha,beta,stable,deprecated",
    ),
    deploy_target: Optional[str] = Query(
        default=None,
        description=(
            "Comma-separated deployment targets. Allowed: universal,server,workstation"
        ),
    ),
    category: Optional[str] = Query(
        default=None,
        description="Comma-separated categories (from roles/categories.yml if available).",
    ),
    tags: Optional[str] = Query(
        default=None,
        description="Comma-separated galaxy tags (matches any).",
    ),
    q: Optional[str] = Query(
        default=None,
        description="Text search across id, display_name, description (case-insensitive).",
    ),
) -> List[RoleOut]:
    """
    Canonical roles endpoint with combinable filters.

    Behavior:
      - Filters are combinable (AND across filter groups, OR within each group).
      - Invalid filter values yield empty results (no errors).
      - Results are served from a cached index for performance.
    """
    query = _build_query(
        status=status,
        deploy_target=deploy_target,
        category=category,
        tags=tags,
        q=q,
    )
    return _index.query(query)


@router.get("/metadata", response_model=List[RoleOut])
def list_roles_metadata_alias(
    status: Optional[str] = Query(
        default=None,
        description="Alias of GET /api/roles. Comma-separated statuses.",
    ),
    deploy_target: Optional[str] = Query(
        default=None,
        description="Alias of GET /api/roles. Comma-separated deployment targets.",
    ),
    category: Optional[str] = Query(
        default=None,
        description="Alias of GET /api/roles. Comma-separated categories.",
    ),
    tags: Optional[str] = Query(
        default=None,
        description="Alias of GET /api/roles. Comma-separated galaxy tags.",
    ),
    q: Optional[str] = Query(
        default=None,
        description="Alias of GET /api/roles. Text search.",
    ),
) -> List[RoleOut]:
    """
    Backwards-compatible alias for older clients that still call /api/roles/metadata.
    """
    query = _build_query(
        status=status,
        deploy_target=deploy_target,
        category=category,
        tags=tags,
        q=q,
    )
    return _index.query(query)


@router.get("/{role_id}", response_model=RoleOut)
def get_role(role_id: str) -> RoleOut:
    """
    Single role endpoint. Returns 404 if role is not in the canonical catalog
    or if the role directory is missing/invalid.
    """
    return _index.get(role_id)
