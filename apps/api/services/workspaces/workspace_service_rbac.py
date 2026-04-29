"""Workspace RBAC mixin (req 019) — extracted from
workspace_service_management.py to keep that file under the repo's
500-line per-file cap.

Provides owner / member / pending-invite logic on top of the
filesystem-based workspace.json store. Identity stays opaque-string from
the OAuth2-Proxy headers per req 007 — there is no user table.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import HTTPException

from .paths import workspace_dir, workspaces_root
from .workspace_context import (
    _load_meta,
    _now_iso,
    _sanitize_workspace_id,
    _sanitize_workspace_state,
    _workspace_last_modified_iso,
    _write_meta,
)


class WorkspaceServiceRBACMixin:
    """RBAC operations: access checks, member listing, invites, transfer.

    Relies on `self.ensure(workspace_id)` and `self.workspace_write_lock`
    being provided by the other mixins composed into `WorkspaceService`.
    """

    @staticmethod
    def _normalize_email(email: str | None) -> str | None:
        if not email:
            return None
        return email.strip().lower() or None

    @classmethod
    def _normalize_members(cls, raw: Any) -> list[dict[str, Any]]:
        """Normalize the members list loaded from workspace.json.

        Tolerates absence (older workspaces) or non-list values by
        returning an empty list. Drops malformed entries silently.
        """
        if not isinstance(raw, list):
            return []
        cleaned: list[dict[str, Any]] = []
        for entry in raw:
            if not isinstance(entry, dict):
                continue
            user_id = str(entry.get("user_id") or "").strip() or None
            email = cls._normalize_email(entry.get("email"))
            if not user_id and not email:
                continue
            cleaned.append(
                {
                    "user_id": user_id,
                    "email": email,
                    "joined_at": entry.get("joined_at") or None,
                    "invited_at": entry.get("invited_at") or None,
                    "invited_by": entry.get("invited_by") or None,
                }
            )
        return cleaned

    def _meta_with_members(self, root: Path) -> dict[str, Any]:
        meta = _load_meta(root)
        meta["members"] = self._normalize_members(meta.get("members"))
        return meta

    def assert_workspace_access(
        self,
        workspace_id: str,
        user_id: str | None,
        email: str | None = None,
    ) -> dict[str, Any]:
        """Authorise a request against a workspace (req 007 + 019)."""
        root = self.ensure(workspace_id)  # type: ignore[attr-defined]
        meta = self._meta_with_members(root)
        owner_id = str(meta.get("owner_id") or "").strip() or None
        actor_id = (user_id or "").strip() or None
        actor_email = self._normalize_email(email)

        if not owner_id:
            if actor_id:
                raise HTTPException(status_code=404, detail="workspace not found")
            return meta

        if actor_id and actor_id == owner_id:
            return meta

        if not actor_id:
            raise HTTPException(status_code=404, detail="workspace not found")

        members = meta.get("members") or []
        for entry in members:
            if entry.get("user_id") and entry["user_id"] == actor_id:
                return meta

        if actor_email:
            changed = False
            for entry in members:
                if entry.get("user_id"):
                    continue
                if entry.get("email") and entry["email"] == actor_email:
                    entry["user_id"] = actor_id
                    entry["joined_at"] = _now_iso()
                    entry["invited_at"] = entry.get("invited_at") or None
                    changed = True
                    break
            if changed:
                meta["members"] = members
                meta["updated_at"] = _now_iso()
                _write_meta(root, meta)
                return meta

        raise HTTPException(status_code=404, detail="workspace not found")

    def list_for_user(self, user_id: str) -> list[dict[str, Any]]:
        """Workspaces where the caller is owner OR claimed member.

        Pending-invite-only matches do NOT appear here per req 019.
        """
        actor_id = (user_id or "").strip()
        if not actor_id:
            return []

        root = workspaces_root()
        if not root.is_dir():
            return []

        workspaces: list[dict[str, Any]] = []
        for child in sorted(root.iterdir()):
            if not child.is_dir():
                continue
            workspace_id = child.name
            try:
                _sanitize_workspace_id(workspace_id)
            except HTTPException:
                continue

            meta = self._meta_with_members(child)
            owner_id = str(meta.get("owner_id") or "").strip() or None

            role: str | None = None
            if owner_id and owner_id == actor_id:
                role = "owner"
            else:
                for entry in meta.get("members") or []:
                    if entry.get("user_id") == actor_id:
                        role = "member"
                        break
            if role is None:
                continue

            workspaces.append(
                {
                    "workspace_id": workspace_id,
                    "name": str(meta.get("name") or workspace_id),
                    "created_at": str(meta.get("created_at") or ""),
                    "last_modified_at": _workspace_last_modified_iso(child),
                    "state": _sanitize_workspace_state(meta.get("state")),
                    "role": role,
                }
            )

        workspaces.sort(
            key=lambda item: str(item.get("last_modified_at") or ""),
            reverse=True,
        )
        return workspaces

    def list_members(self, workspace_id: str) -> dict[str, Any]:
        root = self.ensure(workspace_id)  # type: ignore[attr-defined]
        meta = self._meta_with_members(root)
        owner_entry = {
            "user_id": str(meta.get("owner_id") or "").strip() or None,
            "email": self._normalize_email(meta.get("owner_email")),
            "role": "owner",
            "joined_at": str(meta.get("created_at") or "") or None,
            "invited_at": None,
            "invited_by": None,
        }
        members: list[dict[str, Any]] = []
        pending: list[dict[str, Any]] = []
        for entry in meta.get("members") or []:
            shaped = {
                "user_id": entry.get("user_id"),
                "email": entry.get("email"),
                "role": "member",
                "joined_at": entry.get("joined_at"),
                "invited_at": entry.get("invited_at"),
                "invited_by": entry.get("invited_by"),
            }
            if entry.get("user_id"):
                members.append(shaped)
            else:
                pending.append(shaped)
        return {"owner": owner_entry, "members": members, "pending": pending}

    def invite_member(
        self,
        workspace_id: str,
        *,
        invited_by: str,
        email: str,
    ) -> dict[str, Any]:
        normalized = self._normalize_email(email)
        if not normalized:
            raise HTTPException(status_code=400, detail="email required")
        with self.workspace_write_lock(workspace_id):  # type: ignore[attr-defined]
            root = self.ensure(workspace_id)  # type: ignore[attr-defined]
            meta = self._meta_with_members(root)
            owner_email = self._normalize_email(meta.get("owner_email"))
            if owner_email == normalized:
                raise HTTPException(
                    status_code=409, detail="email already used by owner"
                )
            for entry in meta.get("members") or []:
                if entry.get("email") == normalized:
                    raise HTTPException(
                        status_code=409, detail="email already invited"
                    )
            new_entry = {
                "user_id": None,
                "email": normalized,
                "joined_at": None,
                "invited_at": _now_iso(),
                "invited_by": invited_by or None,
            }
            members = list(meta.get("members") or [])
            members.append(new_entry)
            meta["members"] = members
            meta["updated_at"] = _now_iso()
            _write_meta(root, meta)
            return {
                "user_id": None,
                "email": normalized,
                "role": "member",
                "joined_at": None,
                "invited_at": new_entry["invited_at"],
                "invited_by": new_entry["invited_by"],
            }

    def remove_member(self, workspace_id: str, key: str) -> None:
        target = (key or "").strip()
        if not target:
            raise HTTPException(status_code=400, detail="member key required")
        target_email = self._normalize_email(target)
        with self.workspace_write_lock(workspace_id):  # type: ignore[attr-defined]
            root = self.ensure(workspace_id)  # type: ignore[attr-defined]
            meta = self._meta_with_members(root)
            owner_id = str(meta.get("owner_id") or "").strip() or None
            owner_email = self._normalize_email(meta.get("owner_email"))
            if owner_id and target == owner_id:
                raise HTTPException(
                    status_code=400, detail="cannot remove the workspace owner"
                )
            if owner_email and target_email == owner_email:
                raise HTTPException(
                    status_code=400, detail="cannot remove the workspace owner"
                )

            members = list(meta.get("members") or [])
            new_members = []
            removed = False
            for entry in members:
                if not removed and (
                    entry.get("user_id") == target
                    or (target_email and entry.get("email") == target_email)
                ):
                    removed = True
                    continue
                new_members.append(entry)
            if not removed:
                raise HTTPException(status_code=404, detail="member not found")
            meta["members"] = new_members
            meta["updated_at"] = _now_iso()
            _write_meta(root, meta)

    def transfer_ownership(
        self, workspace_id: str, *, new_owner_id: str
    ) -> dict[str, Any]:
        target = (new_owner_id or "").strip()
        if not target:
            raise HTTPException(status_code=400, detail="new_owner_id required")
        with self.workspace_write_lock(workspace_id):  # type: ignore[attr-defined]
            root = self.ensure(workspace_id)  # type: ignore[attr-defined]
            meta = self._meta_with_members(root)
            current_owner = str(meta.get("owner_id") or "").strip() or None
            current_email = self._normalize_email(meta.get("owner_email"))
            if not current_owner:
                raise HTTPException(
                    status_code=400, detail="workspace has no owner"
                )
            if current_owner == target:
                raise HTTPException(
                    status_code=409, detail="user is already the owner"
                )

            members = list(meta.get("members") or [])
            promoted_entry = None
            remaining: list[dict[str, Any]] = []
            for entry in members:
                if promoted_entry is None and entry.get("user_id") == target:
                    promoted_entry = entry
                    continue
                remaining.append(entry)
            if promoted_entry is None:
                raise HTTPException(
                    status_code=400,
                    detail="new_owner_id is not a claimed member",
                )

            remaining.append(
                {
                    "user_id": current_owner,
                    "email": current_email,
                    "joined_at": _now_iso(),
                    "invited_at": None,
                    "invited_by": None,
                }
            )

            meta["owner_id"] = target
            meta["owner_email"] = promoted_entry.get("email")
            meta["members"] = remaining
            meta["updated_at"] = _now_iso()
            _write_meta(root, meta)
            return {
                "ok": True,
                "new_owner_id": target,
                "previous_owner_id": current_owner,
            }
