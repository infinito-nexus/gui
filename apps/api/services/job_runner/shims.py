from __future__ import annotations

from pathlib import Path

from .util import atomic_write_text

BAUDOLO_SEED_SHIM = """#!/usr/bin/env python3
import csv
import os
import re
import sys

DB_NAME_RE = re.compile(r"^[a-zA-Z0-9_][a-zA-Z0-9_-]*$")
FIELDNAMES = ["instance", "database", "username", "password"]


def _validate_database(value: str, *, instance: str) -> str:
    database = (value or "").strip()
    if not database:
        raise ValueError(
            "Invalid databases.csv entry for instance "
            f"'{instance}': column 'database' must be '*' or a concrete database name."
        )
    if database == "*":
        return database
    if database.lower() == "nan":
        raise ValueError(
            f"Invalid databases.csv entry for instance '{instance}': database must not be 'nan'."
        )
    if not DB_NAME_RE.match(database):
        raise ValueError(
            "Invalid databases.csv entry for instance "
            f"'{instance}': invalid database name '{database}'."
        )
    return database


def _read_rows(path: str) -> list[dict[str, str]]:
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle, delimiter=";")
            if not reader.fieldnames:
                print(
                    f"WARNING: databases.csv exists but is empty: {path}. Creating header columns.",
                    file=sys.stderr,
                )
                return []
            return [{key: str(value or "") for key, value in row.items()} for row in reader]
    except StopIteration:
        print(
            f"WARNING: databases.csv exists but is empty: {path}. Creating header columns.",
            file=sys.stderr,
        )
        return []


def _write_rows(path: str, rows: list[dict[str, str]]) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDNAMES, delimiter=";")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in FIELDNAMES})


def main() -> int:
    if len(sys.argv) != 6:
        print(
            "ERROR: expected arguments: <file> <instance> <database> <username> <password>",
            file=sys.stderr,
        )
        return 1

    file_path, instance, database, username, password = sys.argv[1:]
    try:
        database = _validate_database(database, instance=instance)
        rows = _read_rows(file_path)
        updated = False
        for row in rows:
            if row.get("instance") == instance and row.get("database") == database:
                row["username"] = username
                row["password"] = password
                updated = True
                break
        if not updated:
            rows.append(
                {
                    "instance": instance,
                    "database": database,
                    "username": username,
                    "password": password,
                }
            )
        _write_rows(file_path, rows)
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
"""


INFINITO_SHIM = """#!/usr/bin/env bash
set -euo pipefail

repo_root="${JOB_RUNNER_REPO_DIR:-${PYTHONPATH%%:*}}"
if [ -n "${repo_root}" ] && [ -d "${repo_root}" ]; then
  cd "${repo_root}"
fi

runtime_python="${PYTHON:-/opt/venvs/infinito/bin/python}"
if [ -x "${runtime_python}" ]; then
  exec "${runtime_python}" -m cli.__main__ "$@"
fi

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m cli.__main__ "$@"
fi

exec python -m cli.__main__ "$@"
"""


def write_controller_shims(dest_root: Path) -> None:
    baudolo_seed_path = dest_root / "baudolo-seed"
    atomic_write_text(baudolo_seed_path, BAUDOLO_SEED_SHIM)
    baudolo_seed_path.chmod(0o755)


def write_infinito_shim(job_dir: Path) -> None:
    shim_path = job_dir / "infinito"
    if shim_path.exists():
        return
    atomic_write_text(shim_path, INFINITO_SHIM)
    shim_path.chmod(0o700)
