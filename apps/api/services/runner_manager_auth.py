from __future__ import annotations

import os
import secrets
from pathlib import Path

from fastapi import Header, HTTPException

_MANAGER_TOKEN_HEADER = "x-manager-token"


def manager_token_file() -> Path:
    raw = (os.getenv("MANAGER_TOKEN_FILE") or "/run/manager/token").strip()
    return Path(raw or "/run/manager/token")


def load_manager_token() -> str:
    path = manager_token_file()
    try:
        token = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"manager token file is unavailable: {exc}",
        ) from exc
    if not token:
        raise HTTPException(status_code=500, detail="manager token file is empty")
    return token


def manager_auth_headers() -> dict[str, str]:
    return {_MANAGER_TOKEN_HEADER: load_manager_token()}


def require_manager_token(
    x_manager_token: str | None = Header(default=None),
) -> None:
    presented = str(x_manager_token or "").strip()
    expected = load_manager_token()
    if not presented or not secrets.compare_digest(presented, expected):
        raise HTTPException(status_code=401, detail="invalid manager token")
