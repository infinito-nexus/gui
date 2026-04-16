from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Mapping

from api.schemas.deployment import DeploymentRequest

from .util import atomic_write_json


def load_json(path: Path) -> Dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_meta(path: Path, meta: Mapping[str, Any]) -> None:
    # Accept Mapping to avoid type-ignore when we load Dict[str, Any] from disk.
    atomic_write_json(path, dict(meta))


def mask_request_for_persistence(req: DeploymentRequest) -> Dict[str, Any]:
    """
    Persist only what we must. Never write secrets to disk.
    """
    data = req.model_dump()
    auth = dict(data.get("auth") or {})
    method = auth.get("method")
    data["auth"] = {"method": method}  # drop password/private_key
    data.pop("master_password", None)
    return data
