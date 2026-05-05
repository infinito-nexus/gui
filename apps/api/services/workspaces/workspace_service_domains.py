"""Workspace domain status mixin.

Domains live as a list under `INFINITO_DOMAINS` in
`group_vars/all.yml`. Each entry has a lifecycle status:

  reserved -> ordered -> active <-> disabled
                  \\-> failed -> ordered (retry)

`transition_domain_status` enforces allowed transitions and stamps
`status_changed_at`. Backward compatibility: entries without a
`status` field are treated as `active` (existing domains were assumed
to be in use before this column existed).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from fastapi import HTTPException

from services.job_runner.util import atomic_write_text, safe_mkdir
from .workspace_context import _now_iso

DOMAIN_CATALOG_KEY = "INFINITO_DOMAINS"

ALLOWED_STATUSES: tuple[str, ...] = (
    "reserved",
    "ordered",
    "active",
    "disabled",
    "failed",
    "cancelled",
)

# Map of from-status -> set of allowed next statuses. Hard deletions
# (Remove) are not modeled here — those are the DELETE endpoint's
# job. `cancelled` is terminal: a cancelled order can't be revived,
# only removed.
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "reserved": {"ordered"},
    "ordered": {"active", "failed", "cancelled"},
    "active": {"disabled"},
    "disabled": {"active"},
    "failed": {"ordered", "cancelled"},
    "cancelled": set(),
}

# Transitions that require the caller to be in the administrator
# group. The route layer enforces this — customers can only
# `cancel` their own ordered/failed entries; marking active/failed
# is an operational outcome only admins can declare.
ADMIN_ONLY_TRANSITIONS: set[str] = {"active", "failed"}


def _normalize_domain(value: Any) -> str:
    return str(value or "").strip().lower()


def _normalize_status(value: Any) -> str:
    return str(value or "").strip().lower()


class WorkspaceServiceDomainsMixin:
    def _all_yml_path(self, workspace_id: str) -> Path:
        root: Path = self.ensure(workspace_id)  # type: ignore[attr-defined]
        all_yml = root / "group_vars" / "all.yml"
        safe_mkdir(all_yml.parent)
        return all_yml

    def _load_all_yml(self, workspace_id: str) -> dict[str, Any]:
        path = self._all_yml_path(workspace_id)
        if not path.is_file():
            return {}
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except Exception:
            return {}
        return data if isinstance(data, dict) else {}

    def _write_all_yml(self, workspace_id: str, data: dict[str, Any]) -> None:
        path = self._all_yml_path(workspace_id)
        try:
            atomic_write_text(path, yaml.safe_dump(data, sort_keys=False))
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"failed to write group_vars/all.yml: {exc}",
            ) from exc

    def list_domains(self, workspace_id: str) -> list[dict[str, Any]]:
        """Return all domains for the workspace, with normalized status.

        Entries missing `status` are surfaced as `active` so existing
        workspaces don't lose their domains after this migration.
        """
        data = self._load_all_yml(workspace_id)
        raw_catalog = data.get(DOMAIN_CATALOG_KEY)
        if not isinstance(raw_catalog, list):
            return []
        out: list[dict[str, Any]] = []
        for raw in raw_catalog:
            if isinstance(raw, str):
                domain = _normalize_domain(raw)
                if not domain:
                    continue
                out.append(
                    {
                        "domain": domain,
                        "type": "fqdn" if "." in domain else "local",
                        "parent_fqdn": None,
                        "status": "active",
                        "status_changed_at": None,
                        "order_id": None,
                    }
                )
                continue
            if not isinstance(raw, dict):
                continue
            domain = _normalize_domain(raw.get("domain") or raw.get("value"))
            if not domain:
                continue
            kind = _normalize_status(raw.get("type") or raw.get("kind"))
            if kind not in ("local", "fqdn", "subdomain"):
                kind = "fqdn" if "." in domain else "local"
            status = _normalize_status(raw.get("status"))
            if status not in ALLOWED_STATUSES:
                status = "active"
            parent_fqdn = _normalize_domain(
                raw.get("parent_fqdn") or raw.get("parentFqdn")
            )
            order_id_raw = raw.get("order_id") or raw.get("orderId")
            out.append(
                {
                    "domain": domain,
                    "type": kind,
                    "parent_fqdn": parent_fqdn or None,
                    "status": status,
                    "status_changed_at": str(raw.get("status_changed_at") or "")
                    or None,
                    "order_id": str(order_id_raw or "") or None,
                }
            )
        return out

    def transition_domain_status(
        self,
        workspace_id: str,
        domain: str,
        next_status: str,
        *,
        order_id: str | None = None,
    ) -> dict[str, Any]:
        """Move a domain to a new status, validating the transition.

        Reads `group_vars/all.yml`, locates the matching INFINITO_DOMAINS
        entry, and updates it in place. If the requested transition is
        not in ALLOWED_TRANSITIONS, raises 400. Stamps
        `status_changed_at`. When entering `ordered`, an `order_id` may
        be attached.
        """
        target_domain = _normalize_domain(domain)
        if not target_domain:
            raise HTTPException(status_code=400, detail="domain is required")
        normalized_next = _normalize_status(next_status)
        if normalized_next not in ALLOWED_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"unsupported status: {next_status!r}",
            )

        with self.workspace_write_lock(workspace_id):
            data = self._load_all_yml(workspace_id)
            raw_catalog = data.get(DOMAIN_CATALOG_KEY)
            if not isinstance(raw_catalog, list):
                raise HTTPException(
                    status_code=404,
                    detail=f"domain not found: {target_domain}",
                )

            updated_index = -1
            current_status = "active"
            for idx, raw in enumerate(raw_catalog):
                if isinstance(raw, str):
                    if _normalize_domain(raw) == target_domain:
                        updated_index = idx
                        current_status = "active"
                        break
                    continue
                if not isinstance(raw, dict):
                    continue
                if (
                    _normalize_domain(raw.get("domain") or raw.get("value"))
                    == target_domain
                ):
                    updated_index = idx
                    current_status = _normalize_status(raw.get("status")) or "active"
                    break

            if updated_index < 0:
                raise HTTPException(
                    status_code=404,
                    detail=f"domain not found: {target_domain}",
                )

            allowed = ALLOWED_TRANSITIONS.get(current_status, set())
            if normalized_next not in allowed and normalized_next != current_status:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"transition {current_status!r} -> {normalized_next!r} "
                        f"is not allowed"
                    ),
                )

            # Coerce string-form entry to dict before mutating.
            entry = raw_catalog[updated_index]
            if isinstance(entry, str):
                entry = {
                    "type": "fqdn" if "." in target_domain else "local",
                    "domain": target_domain,
                }
            elif isinstance(entry, dict):
                entry = dict(entry)
                entry["domain"] = target_domain
            else:
                entry = {"type": "fqdn", "domain": target_domain}

            now = _now_iso()
            entry["status"] = normalized_next
            entry["status_changed_at"] = now
            if normalized_next == "ordered" and order_id:
                entry["order_id"] = str(order_id).strip() or None
            elif normalized_next in ("active", "disabled"):
                # Active/disabled implies the order has been fulfilled
                # (or the domain never came from an order); drop the
                # link so future transitions don't carry stale ids.
                entry.pop("order_id", None)

            raw_catalog[updated_index] = entry
            data[DOMAIN_CATALOG_KEY] = raw_catalog
            self._write_all_yml(workspace_id, data)

            return {
                "domain": target_domain,
                "status": normalized_next,
                "status_changed_at": now,
                "order_id": entry.get("order_id") or None,
            }
