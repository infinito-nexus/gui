from __future__ import annotations

import datetime as _dt
import time
import uuid
from pathlib import Path
from typing import Any, Dict


def utc_iso(ts: float | None = None) -> str:
    if ts is None:
        ts = time.time()
    dt = _dt.datetime.fromtimestamp(ts, tz=_dt.timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def safe_mkdir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def atomic_write_text(path: Path, text: str) -> None:
    safe_mkdir(path.parent)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def atomic_write_json(path: Path, data: Dict[str, Any]) -> None:
    import json

    atomic_write_text(path, json.dumps(data, indent=2, sort_keys=False))
