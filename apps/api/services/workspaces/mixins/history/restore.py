from __future__ import annotations

import io
import json
import shutil
import tarfile
import tempfile
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from services.job_runner.util import safe_mkdir
from ..context import (
    WORKSPACE_META_FILENAME,
    _safe_resolve,
    load_workspace_yaml_document,
)


class WorkspaceServiceHistoryRestoreMixin:
    def _export_history_snapshot(
        self, root: Path, sha: str, destination: Path, path: str | None = None
    ) -> None:
        args = ["archive", "--format=tar", sha]
        if path:
            args.append(path)
        result = self._run_git(root, args, text=False, check=False)
        if result.returncode != 0:
            stderr = (
                result.stderr.decode("utf-8", errors="replace")
                if isinstance(result.stderr, bytes)
                else str(result.stderr or "")
            ).strip()
            if "did not match any files" in stderr.lower():
                raise HTTPException(
                    status_code=404, detail="path not found in history commit"
                )
            raise HTTPException(
                status_code=500, detail=stderr or "failed to export history"
            )

        payload = result.stdout if isinstance(result.stdout, bytes) else b""
        if not payload:
            return
        safe_mkdir(destination)
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:") as archive:
            for member in archive.getmembers():
                target = destination / member.name
                resolved = target.resolve()
                if (
                    destination.resolve() not in resolved.parents
                    and resolved != destination.resolve()
                ):
                    raise HTTPException(status_code=400, detail="invalid archive path")
            archive.extractall(destination)

    def _validate_snapshot_files(self, snapshot_root: Path) -> None:
        for path in snapshot_root.rglob("*"):
            if not path.is_file():
                continue
            suffix = path.suffix.lower()
            if suffix not in {".yml", ".yaml", ".json"}:
                continue
            raw = path.read_text(encoding="utf-8", errors="replace")
            try:
                if suffix == ".json":
                    json.loads(raw or "{}")
                else:
                    load_workspace_yaml_document(raw or "{}")
            except Exception as exc:
                rel = path.relative_to(snapshot_root).as_posix()
                raise HTTPException(
                    status_code=400,
                    detail=f"restored content invalid in {rel}: {exc}",
                ) from exc

    def _clear_workspace_payload(self, root: Path) -> None:
        for child in list(root.iterdir()):
            if child.name in {".git", WORKSPACE_META_FILENAME}:
                continue
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink(missing_ok=True)

    def _copy_workspace_payload(self, source: Path, target: Path) -> None:
        for child in source.iterdir():
            if child.name in {".git", WORKSPACE_META_FILENAME}:
                continue
            dest = target / child.name
            if child.is_dir():
                shutil.copytree(child, dest)
            else:
                safe_mkdir(dest.parent)
                shutil.copy2(child, dest)

    def restore_history_workspace(self, workspace_id: str, sha: str) -> dict[str, Any]:
        root = self.ensure(workspace_id)
        if not self._history_repo_exists(root):
            raise HTTPException(status_code=404, detail="history not initialized")
        resolved = self._resolve_history_sha(root, sha)

        snapshot_dir = Path(tempfile.mkdtemp(prefix="workspace-restore-snapshot-"))
        backup_dir = Path(tempfile.mkdtemp(prefix="workspace-restore-backup-"))
        try:
            self._export_history_snapshot(root, resolved, snapshot_dir, path=None)
            self._validate_snapshot_files(snapshot_dir)
            self._copy_workspace_payload(root, backup_dir)

            try:
                self._clear_workspace_payload(root)
                self._copy_workspace_payload(snapshot_dir, root)
            except Exception as exc:
                self._clear_workspace_payload(root)
                self._copy_workspace_payload(backup_dir, root)
                raise HTTPException(
                    status_code=500, detail=f"failed to restore workspace: {exc}"
                ) from exc
        finally:
            shutil.rmtree(snapshot_dir, ignore_errors=True)
            shutil.rmtree(backup_dir, ignore_errors=True)

        self._history_commit(root, f"context: restore workspace ({resolved[:12]})")
        return {"ok": True, "sha": resolved}

    def _remove_path(self, path: Path) -> None:
        if not path.exists():
            return
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink(missing_ok=True)

    def restore_history_path(
        self, workspace_id: str, sha: str, path: str
    ) -> dict[str, Any]:
        root = self.ensure(workspace_id)
        if not self._history_repo_exists(root):
            raise HTTPException(status_code=404, detail="history not initialized")

        normalized_path = self._normalize_history_path(root, path)
        if not normalized_path:
            raise HTTPException(status_code=400, detail="path is required")
        resolved = self._resolve_history_sha(root, sha)

        snapshot_dir = Path(tempfile.mkdtemp(prefix="workspace-restore-path-snapshot-"))
        backup_dir = Path(tempfile.mkdtemp(prefix="workspace-restore-path-backup-"))
        destination = _safe_resolve(root, normalized_path)
        source = snapshot_dir / normalized_path

        had_destination = destination.exists()
        backup_payload = backup_dir / "payload"
        try:
            self._export_history_snapshot(
                root, resolved, snapshot_dir, path=normalized_path
            )
            if not source.exists():
                raise HTTPException(
                    status_code=404, detail="path not found in history commit"
                )
            self._validate_snapshot_files(snapshot_dir)

            if had_destination:
                if destination.is_dir():
                    shutil.copytree(destination, backup_payload)
                else:
                    safe_mkdir(backup_payload.parent)
                    shutil.copy2(destination, backup_payload)

            try:
                self._remove_path(destination)
                if source.is_dir():
                    safe_mkdir(destination.parent)
                    shutil.copytree(source, destination)
                else:
                    safe_mkdir(destination.parent)
                    shutil.copy2(source, destination)
            except Exception as exc:
                self._remove_path(destination)
                if had_destination and backup_payload.exists():
                    if backup_payload.is_dir():
                        shutil.copytree(backup_payload, destination)
                    else:
                        safe_mkdir(destination.parent)
                        shutil.copy2(backup_payload, destination)
                raise HTTPException(
                    status_code=500, detail=f"failed to restore path: {exc}"
                ) from exc
        finally:
            shutil.rmtree(snapshot_dir, ignore_errors=True)
            shutil.rmtree(backup_dir, ignore_errors=True)

        self._history_commit(
            root,
            f"context: restore path ({normalized_path})",
        )
        return {"ok": True, "sha": resolved, "path": normalized_path}
