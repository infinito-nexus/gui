from __future__ import annotations

import copy
import json
import re
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from .support import (
    INVENTORY_FILENAME,
    WORKSPACE_META_FILENAME,
    ZIP_IMPORT_MODES,
    _dump_yaml_mapping,
    _load_meta,
    _now_iso,
    _safe_resolve,
    _write_meta,
    load_workspace_yaml_document,
    safe_mkdir,
    zip_member_has_unsafe_mode,
    zip_member_is_symlink,
)


class WorkspaceServiceArtifactsZipMixin:
    def build_zip(self, workspace_id: str) -> bytes:
        import os
        import zipfile

        root = self.ensure(workspace_id)
        buffer = BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for dirpath, _dirnames, filenames in os.walk(root):
                current_dir = Path(dirpath)
                for filename in filenames:
                    if filename == WORKSPACE_META_FILENAME:
                        continue
                    file_path = current_dir / filename
                    archive.write(file_path, file_path.relative_to(root).as_posix())
        return buffer.getvalue()

    def _refresh_meta_after_upload(self, root):
        meta = _load_meta(root)
        changed = False

        inventory_path = root / INVENTORY_FILENAME
        if inventory_path.exists() and not meta.get("inventory_generated_at"):
            meta["inventory_generated_at"] = _now_iso()
            changed = True

        host_vars_file = meta.get("host_vars_file")
        if host_vars_file:
            try:
                if not _safe_resolve(root, host_vars_file).is_file():
                    host_vars_file = None
            except HTTPException:
                host_vars_file = None

        if not host_vars_file:
            host_vars_dir = root / "host_vars"
            if host_vars_dir.is_dir():
                candidates = sorted(
                    [
                        path
                        for path in host_vars_dir.iterdir()
                        if path.is_file() and path.suffix in (".yml", ".yaml")
                    ]
                )
                if candidates:
                    meta["host_vars_file"] = f"host_vars/{candidates[0].name}"
                    changed = True

        if changed:
            _write_meta(root, meta)

    def _normalize_zip_member_path(self, name: str) -> str | None:
        raw = (name or "").replace("\\", "/")
        if not raw or raw.endswith("/"):
            return None
        if raw.startswith("/") or raw.startswith("\\"):
            return None
        if re.match(r"^[A-Za-z]:", raw):
            return None

        parts = [part for part in raw.split("/") if part]
        if not parts or any(part == ".." for part in parts):
            return None
        if any(part == WORKSPACE_META_FILENAME for part in parts):
            return None
        return "/".join(parts)

    def _resolve_zip_mode(
        self,
        rel_path: str,
        *,
        default_mode: str,
        per_file_mode: dict[str, str] | None,
    ) -> str:
        mode = (
            str((per_file_mode or {}).get(rel_path) or default_mode or "override")
            .strip()
            .lower()
        )
        return mode if mode in ZIP_IMPORT_MODES else "override"

    def _merge_mappings_inplace(
        self,
        destination: dict[str, Any],
        source: dict[str, Any],
    ) -> None:
        for key, value in source.items():
            if (
                key in destination
                and isinstance(destination[key], dict)
                and isinstance(value, dict)
            ):
                self._merge_mappings_inplace(destination[key], value)
                continue
            destination[key] = copy.deepcopy(value)

    def _merge_structured_bytes(
        self,
        rel_path: str,
        existing: bytes,
        incoming: bytes,
    ) -> bytes | None:
        lowered = rel_path.lower()

        if lowered.endswith((".yml", ".yaml")):
            try:
                existing_loaded = load_workspace_yaml_document(
                    existing.decode("utf-8", errors="strict") or "{}"
                )
                incoming_loaded = load_workspace_yaml_document(
                    incoming.decode("utf-8", errors="strict") or "{}"
                )
            except Exception:
                return None

            if existing_loaded is None:
                existing_loaded = {}
            if incoming_loaded is None:
                incoming_loaded = {}
            if not isinstance(existing_loaded, dict) or not isinstance(
                incoming_loaded, dict
            ):
                return None

            merged = copy.deepcopy(existing_loaded)
            self._merge_mappings_inplace(merged, incoming_loaded)
            return _dump_yaml_mapping(merged).encode("utf-8")

        if lowered.endswith(".json"):
            try:
                existing_loaded = json.loads(
                    existing.decode("utf-8", errors="strict") or "{}"
                )
                incoming_loaded = json.loads(
                    incoming.decode("utf-8", errors="strict") or "{}"
                )
            except Exception:
                return None

            if not isinstance(existing_loaded, dict) or not isinstance(
                incoming_loaded, dict
            ):
                return None

            merged = copy.deepcopy(existing_loaded)
            self._merge_mappings_inplace(merged, incoming_loaded)
            content = json.dumps(merged, ensure_ascii=False, indent=2, sort_keys=False)
            if not content.endswith("\n"):
                content = f"{content}\n"
            return content.encode("utf-8")

        return None

    def list_zip_entries(self, data: bytes) -> list[str]:
        import zipfile

        try:
            archive = zipfile.ZipFile(BytesIO(data))
        except Exception as exc:
            raise HTTPException(status_code=400, detail="invalid zip") from exc

        entries: set[str] = set()
        with archive:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                rel_path = self._normalize_zip_member_path(info.filename or "")
                if rel_path:
                    entries.add(rel_path)
        return sorted(entries)

    def load_zip(
        self,
        workspace_id: str,
        data: bytes,
        *,
        default_mode: str = "override",
        per_file_mode: dict[str, str] | None = None,
    ) -> dict[str, int]:
        import zipfile

        with self.workspace_write_lock(workspace_id):
            root = self.ensure(workspace_id)
            try:
                archive = zipfile.ZipFile(BytesIO(data))
            except Exception as exc:
                raise HTTPException(status_code=400, detail="invalid zip") from exc

            default_mode_normalized = str(default_mode or "override").strip().lower()
            if default_mode_normalized not in ZIP_IMPORT_MODES:
                default_mode_normalized = "override"

            root_resolved = root.resolve()
            created_files = 0
            overridden_files = 0
            merged_files = 0
            skipped_files = 0

            with archive:
                for info in archive.infolist():
                    if info.is_dir():
                        continue

                    if zip_member_is_symlink(info):
                        raise HTTPException(
                            status_code=400,
                            detail=f"zip import rejected symlink entry: {info.filename}",
                        )
                    if zip_member_has_unsafe_mode(info):
                        raise HTTPException(
                            status_code=400,
                            detail=f"zip import rejected writable entry: {info.filename}",
                        )

                    rel_path = self._normalize_zip_member_path(info.filename or "")
                    if not rel_path:
                        continue

                    target = root / rel_path
                    resolved = target.resolve()
                    if (
                        resolved == root_resolved
                        or root_resolved not in resolved.parents
                    ):
                        raise HTTPException(
                            status_code=400,
                            detail=f"zip import rejected path traversal entry: {info.filename}",
                        )

                    safe_mkdir(resolved.parent)
                    try:
                        with archive.open(info) as source:
                            incoming_bytes = source.read()
                    except Exception as exc:
                        raise HTTPException(
                            status_code=500,
                            detail=f"failed to extract zip: {exc}",
                        ) from exc

                    existing_bytes: bytes | None = None
                    if resolved.is_file():
                        try:
                            existing_bytes = resolved.read_bytes()
                        except Exception:
                            existing_bytes = None

                    mode = self._resolve_zip_mode(
                        rel_path,
                        default_mode=default_mode_normalized,
                        per_file_mode=per_file_mode,
                    )

                    payload = incoming_bytes
                    if mode == "merge" and existing_bytes is not None:
                        merged_payload = self._merge_structured_bytes(
                            rel_path,
                            existing_bytes,
                            incoming_bytes,
                        )
                        if merged_payload is None:
                            skipped_files += 1
                            continue
                        payload = merged_payload
                        merged_files += 1
                        if payload == existing_bytes:
                            continue
                    else:
                        if resolved.exists():
                            overridden_files += 1
                        else:
                            created_files += 1

                    try:
                        with open(resolved, "wb") as destination:
                            destination.write(payload)
                    except Exception as exc:
                        raise HTTPException(
                            status_code=500,
                            detail=f"failed to extract zip: {exc}",
                        ) from exc

            self._refresh_meta_after_upload(root)
            self._history_commit(root, "bulk: zip import")
            return {
                "created_files": created_files,
                "overridden_files": overridden_files,
                "merged_files": merged_files,
                "skipped_files": skipped_files,
            }
