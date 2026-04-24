from __future__ import annotations

import logging
import os
import time
from typing import Dict, Iterable, List, Set, Tuple
from urllib.parse import urlparse

from fastapi import HTTPException

from api.schemas.role import RoleLogoOut, RoleOut
from roles.role_metadata_extractor import extract_role_metadata
from services.pricing_engine import load_role_pricing_metadata
from services.role_catalog import RoleCatalogError, RoleCatalogService

from .bundles import bundles_mtime, load_bundle_role_ids
from .categories import load_categories
from .models import RoleQuery, safe_lower, statuses_valid, targets_valid
from .paths import (
    file_mtime,
    is_role_dir,
    list_json_path,
    repo_roles_root,
    categories_path,
)


def _matches_any(haystack: Iterable[str], needles: Set[str]) -> bool:
    hs = {safe_lower(x) for x in haystack}
    return bool(hs.intersection({safe_lower(n) for n in needles}))


LOGGER = logging.getLogger(__name__)


def _normalize_url(value: str | None, role_id: str, field: str) -> str | None:
    raw = (value or "").strip()
    if not raw:
        return None
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        LOGGER.warning("role %s: invalid %s url ignored: %s", role_id, field, raw)
        return None
    return raw


class RoleIndexService:
    """
    Cached role index for fast /api/roles queries.

    Cache invalidation:
      - roles/list.json mtime changes
      - roles/categories.yml mtime changes (if configured)
      - cache TTL

    Notes:
      - This cache is per-process (per worker).
    """

    def __init__(self) -> None:
        self._catalog = RoleCatalogService()

        # Keep the default TTL comfortably above the documented warm-cache perf
        # measurement window so the cache does not invalidate mid-scenario unless
        # a caller opts into a shorter lifetime explicitly.
        self._cache_ttl_seconds = int(
            os.getenv("ROLE_INDEX_TTL_SECONDS", "300") or "300"
        )
        self._cached_at: float = 0.0
        self._cached_key: Tuple[int, int, int] = (0, 0, 0)

        self._roles: List[RoleOut] = []
        self._by_id: Dict[str, RoleOut] = {}

    def _cache_key(self) -> Tuple[int, int, int]:
        return (
            file_mtime(list_json_path()),
            file_mtime(categories_path()),
            bundles_mtime(),
        )

    def _is_cache_valid(self) -> bool:
        if not self._roles:
            return False
        if (time.time() - self._cached_at) > self._cache_ttl_seconds:
            return False
        return self._cached_key == self._cache_key()

    def _build_index(self) -> None:
        try:
            entries = self._catalog.load_roles()
        except RoleCatalogError as exc:
            # Strict: if canonical list is missing/invalid -> server error
            raise HTTPException(status_code=500, detail=str(exc))

        roles_root = repo_roles_root()
        categories = load_categories([entry.id for entry in entries])
        bundle_role_ids = load_bundle_role_ids()
        out: List[RoleOut] = []
        by_id: Dict[str, RoleOut] = {}

        for e in entries:
            role_id = e.id
            role_dir = roles_root / role_id
            if not role_dir.is_dir() or not is_role_dir(role_dir):
                # Canonical list contains an entry that is not a valid role dir -> skip (non-fatal)
                continue

            md = extract_role_metadata(role_dir)

            meta_css_class = (
                md.logo.css_class if md.logo and md.logo.css_class else None
            )
            logo = (
                RoleLogoOut(source="meta", css_class=meta_css_class)
                if meta_css_class
                else None
            )

            documentation = _normalize_url(md.documentation, md.id, "documentation")
            video = _normalize_url(md.video, md.id, "video")
            homepage = _normalize_url(md.homepage, md.id, "homepage")
            issue_tracker_url = _normalize_url(
                md.issue_tracker_url, md.id, "issue_tracker_url"
            )
            license_url = _normalize_url(md.license_url, md.id, "license_url")
            forum = _normalize_url(md.forum, md.id, "forum") if md.forum else None
            pricing, pricing_summary, pricing_warnings = load_role_pricing_metadata(
                role_dir, role_id=md.id
            )
            for warning in pricing_warnings:
                LOGGER.warning("role %s: %s", md.id, warning)

            ro_list = RoleOut(
                id=md.id,
                display_name=md.display_name,
                status=md.status,
                role_name=md.role_name,
                description=md.description,
                author=md.author,
                company=md.company,
                license=md.license,
                license_url=license_url,
                homepage=homepage,
                forum=forum,
                video=video,
                repository=md.repository,
                issue_tracker_url=issue_tracker_url,
                documentation=documentation,
                min_ansible_version=md.min_ansible_version,
                galaxy_tags=md.galaxy_tags,
                dependencies=md.dependencies,
                lifecycle=md.lifecycle,
                run_after=md.run_after,
                platforms=md.platforms,
                logo=logo,
                deployment_targets=md.deployment_targets,
                categories=categories.get(md.id, []),
                bundle_member=md.id in bundle_role_ids,
                pricing_summary=pricing_summary,
            )

            ro_detail_payload = ro_list.model_dump()
            ro_detail_payload["pricing"] = pricing
            ro_detail = RoleOut(**ro_detail_payload)

            out.append(ro_detail)
            by_id[ro_detail.id] = ro_detail

        out.sort(key=lambda r: (safe_lower(r.display_name), safe_lower(r.id)))

        self._roles = out
        self._by_id = by_id
        self._cached_at = time.time()
        self._cached_key = self._cache_key()

    def _ensure_index(self) -> None:
        if not self._is_cache_valid():
            self._build_index()

    def get(self, role_id: str) -> RoleOut:
        self._ensure_index()
        rid = (role_id or "").strip()
        if not rid:
            raise HTTPException(status_code=404, detail="role not found")
        ro = self._by_id.get(rid)
        if not ro:
            raise HTTPException(status_code=404, detail="role not found")
        return ro

    def query(self, q: RoleQuery) -> List[RoleOut]:
        """
        Apply combinable filters:
          - AND across filter groups
          - OR within each group (comma-separated)
        Invalid values -> empty results (not errors).
        """
        self._ensure_index()

        # Enumerated filters: invalid -> empty (per A/C)
        if not statuses_valid(q.statuses):
            return []
        if not targets_valid(q.deploy_targets):
            return []

        qq = safe_lower(q.q) if q.q else None

        results: List[RoleOut] = []
        for ro in self._roles:
            if q.statuses and safe_lower(ro.status) not in q.statuses:
                continue

            if q.deploy_targets and not _matches_any(
                ro.deployment_targets, q.deploy_targets
            ):
                continue

            if q.categories:
                cats = [safe_lower(x) for x in (ro.categories or [])]
                if not set(cats).intersection(q.categories):
                    continue

            if q.tags:
                tags = [safe_lower(x) for x in (ro.galaxy_tags or [])]
                if not set(tags).intersection(q.tags):
                    continue

            if qq:
                hay = " ".join(
                    [
                        safe_lower(ro.id),
                        safe_lower(ro.display_name),
                        safe_lower(ro.description or ""),
                    ]
                )
                if qq not in hay:
                    continue

            results.append(ro)

        return results
