from __future__ import annotations

import json

from fastapi import HTTPException, UploadFile


def ensure_zip_upload(file: UploadFile) -> None:
    filename = (file.filename or "").lower()
    if not filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="zip file required")


def parse_upload_modes(
    default_mode: str,
    per_file_mode_json: str | None,
) -> tuple[str, dict[str, str]]:
    mode_default = str(default_mode or "").strip().lower()
    if mode_default not in {"override", "merge"}:
        raise HTTPException(status_code=400, detail="invalid default_mode")

    per_file_mode: dict[str, str] = {}
    if per_file_mode_json:
        try:
            loaded = json.loads(per_file_mode_json)
        except Exception as exc:
            raise HTTPException(
                status_code=400, detail=f"invalid per_file_mode_json: {exc}"
            ) from exc

        if not isinstance(loaded, dict):
            raise HTTPException(
                status_code=400, detail="per_file_mode_json must be an object"
            )

        for key, value in loaded.items():
            path = str(key or "").strip()
            if not path:
                continue
            mode = str(value or "").strip().lower()
            if mode not in {"override", "merge"}:
                raise HTTPException(
                    status_code=400,
                    detail=f"invalid merge mode for {path}: {mode}",
                )
            per_file_mode[path] = mode

    return mode_default, per_file_mode
