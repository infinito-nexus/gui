from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from services.infinito_nexus_versions import normalize_infinito_nexus_version
from services.job_runner.util import atomic_write_text, safe_mkdir
from .paths import workspace_dir, workspaces_root
from .vault import _ensure_secrets_dirs
from .workspace_context import (
    _HIDDEN_FILES,
    _dump_yaml_mapping,
    _ensure_workspace_root,
    _load_meta,
    _merge_missing,
    _new_workspace_id,
    _now_iso,
    _safe_resolve,
    _sanitize_workspace_id,
    _sanitize_workspace_state,
    _to_entry,
    _workspace_last_modified_iso,
    _write_meta,
    load_workspace_yaml_document,
)


class WorkspaceServiceManagementMixin:
    def __init__(self) -> None:
        _ensure_workspace_root()

    def create(
        self, *, owner_id: str | None = None, owner_email: str | None = None
    ) -> dict[str, Any]:
        _ensure_workspace_root()
        workspace_id = _new_workspace_id()
        root = workspace_dir(workspace_id)
        safe_mkdir(root)
        safe_mkdir(root / "host_vars")
        safe_mkdir(root / "group_vars")
        _ensure_secrets_dirs(root)

        meta = {
            "workspace_id": workspace_id,
            "created_at": _now_iso(),
            "inventory_generated_at": None,
            "infinito_nexus_version": "latest",
            "selected_roles": [],
            "host": None,
            "user": None,
            "auth_method": None,
            "owner_id": (owner_id or "").strip() or None,
            "owner_email": (owner_email or "").strip() or None,
            # req 019 — workspace RBAC. members holds claimed members and
            # pending email invites; new workspaces start empty. Workspaces
            # written before req 019 land are loaded with members=[] in
            # _normalize_members() (see below) so absence is harmless.
            "members": [],
            "state": "draft",
            "updated_at": _now_iso(),
        }
        _write_meta(root, meta)
        return meta

    def ensure(self, workspace_id: str) -> Path:
        workspace_key = _sanitize_workspace_id(workspace_id)
        root = workspace_dir(workspace_key)
        if not root.is_dir():
            raise HTTPException(status_code=404, detail="workspace not found")
        return root

    @staticmethod
    def _normalize_email(email: str | None) -> str | None:
        if not email:
            return None
        return email.strip().lower() or None

    @classmethod
    def _normalize_members(cls, raw: Any) -> list[dict[str, Any]]:
        """Normalize the members list loaded from workspace.json.

        Tolerates absence (older workspaces) or non-list values by
        returning an empty list. Drops malformed entries silently;
        callers MUST pass through atomic_write to persist any
        normalisation outcome they want to commit.
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
        """Authorise a request against a workspace (req 007 + 019).

        Owner: full access.
        Claimed member: full access (workspace contents).
        Pending invite whose email matches the caller: claim it now —
        promote the entry to claimed and persist atomically; then grant
        access. Subsequent calls behave as the claimed-member case.
        Anyone else: HTTP 404 (we do not leak the workspace's existence).
        """
        root = self.ensure(workspace_id)
        meta = self._meta_with_members(root)
        owner_id = str(meta.get("owner_id") or "").strip() or None
        actor_id = (user_id or "").strip() or None
        actor_email = self._normalize_email(email)

        # Anonymous workspace: only callers without auth see it (legacy req 007).
        if not owner_id:
            if actor_id:
                raise HTTPException(status_code=404, detail="workspace not found")
            return meta

        # Owner.
        if actor_id and actor_id == owner_id:
            return meta

        # Anonymous request to an owned workspace → 404.
        if not actor_id:
            raise HTTPException(status_code=404, detail="workspace not found")

        members = meta.get("members") or []
        # Already-claimed member.
        for entry in members:
            if entry.get("user_id") and entry["user_id"] == actor_id:
                return meta

        # Pending invite — claim if email matches.
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

        Pending-invite-only matches do NOT appear here per req 019 — the
        invitee must access the workspace once for the claim to fire.
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

    # ----- req 019 — membership management ---------------------------------

    def list_members(self, workspace_id: str) -> dict[str, Any]:
        root = self.ensure(workspace_id)
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
        with self.workspace_write_lock(workspace_id):
            root = self.ensure(workspace_id)
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
        """Remove a claimed member by user_id or a pending invite by email.

        The owner may not be targeted via this route (use transfer_ownership
        followed by remove). The matched entry is dropped from members[].
        """
        target = (key or "").strip()
        if not target:
            raise HTTPException(status_code=400, detail="member key required")
        target_email = self._normalize_email(target)
        with self.workspace_write_lock(workspace_id):
            root = self.ensure(workspace_id)
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
        with self.workspace_write_lock(workspace_id):
            root = self.ensure(workspace_id)
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

            # Demote current owner to a member entry.
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

    def delete(self, workspace_id: str) -> None:
        root = self.ensure(workspace_id)
        try:
            shutil.rmtree(root)
        except Exception as exc:
            raise HTTPException(
                status_code=500, detail=f"failed to delete workspace: {exc}"
            ) from exc

    def set_workspace_state(self, workspace_id: str, state: str) -> None:
        root = self.ensure(workspace_id)
        meta = _load_meta(root)
        meta["state"] = _sanitize_workspace_state(state)
        meta["updated_at"] = _now_iso()
        _write_meta(root, meta)

    def get_runtime_settings(self, workspace_id: str) -> dict[str, str]:
        root = self.ensure(workspace_id)
        meta = _load_meta(root)
        return {
            "infinito_nexus_version": normalize_infinito_nexus_version(
                str(meta.get("infinito_nexus_version") or "").strip() or "latest"
            )
        }

    def update_runtime_settings(
        self, workspace_id: str, *, infinito_nexus_version: str | None
    ) -> dict[str, str]:
        with self.workspace_write_lock(workspace_id):
            root = self.ensure(workspace_id)
            meta = _load_meta(root)
            meta["infinito_nexus_version"] = normalize_infinito_nexus_version(
                infinito_nexus_version
            )
            meta["updated_at"] = _now_iso()
            _write_meta(root, meta)
            return {
                "infinito_nexus_version": str(
                    meta.get("infinito_nexus_version") or "latest"
                )
            }

    def list_files(self, workspace_id: str) -> list[dict[str, Any]]:
        root = self.ensure(workspace_id)
        entries: list[dict[str, Any]] = []

        for dirpath, dirnames, filenames in os.walk(root):
            current_dir = Path(dirpath)
            dirnames[:] = [name for name in dirnames if name not in _HIDDEN_FILES]
            if current_dir != root:
                directory_entry = _to_entry(root, current_dir, True)
                if directory_entry:
                    entries.append(directory_entry)

            for filename in filenames:
                if filename in _HIDDEN_FILES:
                    continue
                file_entry = _to_entry(root, current_dir / filename, False)
                if file_entry:
                    entries.append(file_entry)

        entries.sort(
            key=lambda entry: (0 if entry.get("is_dir") else 1, entry.get("path") or "")
        )
        return entries

    def read_file(self, workspace_id: str, rel_path: str) -> str:
        root = self.ensure(workspace_id)
        target = _safe_resolve(root, rel_path)
        if not target.is_file():
            raise HTTPException(status_code=404, detail="file not found")
        try:
            return target.read_text(encoding="utf-8", errors="replace")
        except Exception as exc:
            raise HTTPException(
                status_code=500, detail=f"failed to read file: {exc}"
            ) from exc

    def read_file_bytes(self, workspace_id: str, rel_path: str) -> bytes:
        root = self.ensure(workspace_id)
        target = _safe_resolve(root, rel_path)
        if not target.is_file():
            raise HTTPException(status_code=404, detail="file not found")
        try:
            return target.read_bytes()
        except Exception as exc:
            raise HTTPException(
                status_code=500, detail=f"failed to read file: {exc}"
            ) from exc

    def _preserve_host_vars_applications(
        self,
        target: Path,
        content: str,
    ) -> str:
        if target.parent.name != "host_vars" or target.suffix not in {".yml", ".yaml"}:
            return content
        if not target.is_file():
            return content

        try:
            incoming_loaded = load_workspace_yaml_document(content)
            existing_loaded = load_workspace_yaml_document(
                target.read_text(encoding="utf-8", errors="replace")
            )
        except Exception:
            return content

        if not isinstance(incoming_loaded, dict) or not isinstance(
            existing_loaded, dict
        ):
            return content

        existing_applications = existing_loaded.get("applications")
        if not isinstance(existing_applications, dict) or not existing_applications:
            return content

        incoming_applications = incoming_loaded.get("applications")
        if incoming_applications is None:
            incoming_applications = {}
            incoming_loaded["applications"] = incoming_applications
        if not isinstance(incoming_applications, dict):
            return content

        merged_paths = _merge_missing(incoming_applications, existing_applications)
        if merged_paths <= 0:
            return content
        return _dump_yaml_mapping(incoming_loaded)

    def write_file(self, workspace_id: str, rel_path: str, content: str) -> None:
        with self.workspace_write_lock(workspace_id):
            root = self.ensure(workspace_id)
            target = _safe_resolve(root, rel_path)
            existed_before = target.exists()
            safe_mkdir(target.parent)
            content_to_write = self._preserve_host_vars_applications(target, content)
            try:
                atomic_write_text(target, content_to_write)
            except Exception as exc:
                raise HTTPException(
                    status_code=500, detail=f"failed to write file: {exc}"
                ) from exc
            action = "edit" if existed_before else "create"
            self._history_commit(
                root, f"{action}: {target.relative_to(root).as_posix()}"
            )

    def create_dir(self, workspace_id: str, rel_path: str) -> str:
        with self.workspace_write_lock(workspace_id):
            root = self.ensure(workspace_id)
            raw = (rel_path or "").strip().lstrip("/")
            if not raw:
                raise HTTPException(status_code=400, detail="path required")
            if raw.endswith("/"):
                raw = raw.rstrip("/")

            target = _safe_resolve(root, raw)
            if target.exists():
                raise HTTPException(status_code=409, detail="target already exists")

            try:
                safe_mkdir(target)
            except Exception as exc:
                raise HTTPException(
                    status_code=500, detail=f"failed to create directory: {exc}"
                ) from exc
            path = target.relative_to(root).as_posix()
            self._history_commit(root, f"create: {path}")
            return path

    def rename_file(self, workspace_id: str, rel_path: str, new_path: str) -> str:
        with self.workspace_write_lock(workspace_id):
            root = self.ensure(workspace_id)
            source = _safe_resolve(root, rel_path)
            if not source.exists():
                raise HTTPException(status_code=404, detail="file not found")

            raw_new_path = (new_path or "").strip().lstrip("/")
            if not raw_new_path or raw_new_path.endswith("/"):
                raise HTTPException(status_code=400, detail="invalid new path")

            destination = _safe_resolve(root, raw_new_path)
            if source.is_dir() and source in destination.parents:
                raise HTTPException(
                    status_code=400, detail="cannot move directory into itself"
                )
            if destination.exists():
                raise HTTPException(status_code=409, detail="target already exists")
            if not destination.parent.exists():
                raise HTTPException(status_code=400, detail="target directory missing")

            try:
                source.rename(destination)
            except Exception as exc:
                raise HTTPException(
                    status_code=500, detail=f"failed to rename file: {exc}"
                ) from exc
            self._history_commit(
                root,
                f"rename: {source.relative_to(root).as_posix()} -> {destination.relative_to(root).as_posix()}",
            )
            return destination.relative_to(root).as_posix()

    def delete_file(self, workspace_id: str, rel_path: str) -> None:
        with self.workspace_write_lock(workspace_id):
            root = self.ensure(workspace_id)
            target = _safe_resolve(root, rel_path)
            if not target.exists():
                raise HTTPException(status_code=404, detail="file not found")

            try:
                if target.is_dir():
                    shutil.rmtree(target)
                else:
                    target.unlink()
            except Exception as exc:
                raise HTTPException(
                    status_code=500, detail=f"failed to delete file: {exc}"
                ) from exc
            self._history_commit(root, f"delete: {target.relative_to(root).as_posix()}")
