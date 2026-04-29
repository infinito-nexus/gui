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

    # RBAC-related methods (assert_workspace_access, list_for_user,
    # list_members, invite_member, remove_member, transfer_ownership) live
    # in workspace_service_rbac.WorkspaceServiceRBACMixin per req 019.

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
