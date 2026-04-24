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

LOCAL_SUDO_SHIM = """#!/usr/bin/env bash
set -euo pipefail

# Controller-local Ansible tasks inherit become=true from upstream plays, but
# the hardened runner container intentionally runs with no-new-privileges. For
# those controller-side delegates we only need command passthrough, not actual
# privilege escalation inside the runner.
while [ "$#" -gt 0 ]; do
  case "$1" in
    -H|-S|-n|-E|-k)
      shift
      ;;
    -u|-g|-h|-p|-R|-t|-T|-C)
      shift
      if [ "$#" -gt 0 ]; then
        shift
      fi
      ;;
    --)
      shift
      break
      ;;
    --user=*|--group=*|--host=*|--prompt=*|--chdir=*|--command-timeout=*|--close-from=*)
      shift
      ;;
    -*)
      shift
      ;;
    *)
      break
      ;;
  esac
done

if [ "$#" -eq 0 ]; then
  exit 0
fi

exec "$@"
"""

SSH_KEYSCAN_SHIM = """#!/usr/bin/env bash
set -euo pipefail

real_ssh_keyscan="${INFINITO_REAL_SSH_KEYSCAN:-/usr/bin/ssh-keyscan}"
host_arg="${!#:-}"
host_arg="${host_arg#\\[}"
host_arg="${host_arg%\\]}"
key_types=""
prev=""
for arg in "$@"; do
  if [ "${prev}" = "-t" ]; then
    key_types="${arg}"
    break
  fi
  prev="${arg}"
done

if [ "${host_arg}" = "github.com" ]; then
  if [ -z "${key_types}" ] || [ "${key_types}" = "ed25519" ] || printf '%s' "${key_types}" | grep -Eq '(^|,)ed25519(,|$)'; then
    printf '%s\\n' \
      'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII3+7UnC83CxweO0Gr8ptLLxSgSQ4W0NoJhlCz5ZzVwN'
    exit 0
  fi
fi

exec "${real_ssh_keyscan}" "$@"
"""

CONTROLLER_COMMAND_SHIM = """#!/bin/sh
# Controller-side shim for Ansible's command_path lookup of '{command}'.
# The lookup runs on the job runner controller, but the resulting absolute path
# is later used on the target host as well. This shim therefore only needs to
# exist at /usr/bin/{command} in the ephemeral runner container so shutil.which()
# succeeds with the same absolute path that the target host provides.
exit 0
"""

SSHPASS_SHIM = """#!/usr/bin/env python3
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def _usage() -> int:
    print("Usage: sshpass [-p password | -d fd | -f file | -e] command [args...]", file=sys.stderr)
    return 1


def _normalize_password(value: str) -> str:
    if not value:
        return ""
    lines = value.splitlines()
    return lines[0] if lines else value


def _read_fd(fd: int) -> str:
    chunks = []
    while True:
        data = os.read(fd, 4096)
        if not data:
            break
        chunks.append(data)
    return b"".join(chunks).decode("utf-8", errors="ignore")


def _read_password(source: str | None, value: str) -> str:
    if source == "arg":
        return value
    if source == "env":
        return os.getenv("SSHPASS", "")
    if source == "file":
        return Path(value).read_text(encoding="utf-8", errors="ignore")
    if source == "fd":
        return _read_fd(int(value))
    return ""


def _parse(argv: list[str]) -> tuple[str | None, str, list[str]] | int:
    source = None
    value = ""
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--":
            return source, value, argv[index + 1 :]
        if not arg.startswith("-") or arg == "-":
            return source, value, argv[index:]
        if arg in {"-h", "--help"}:
            return _usage()
        if arg in {"-V", "--version"}:
            print("sshpass shim 1.0")
            return 0
        if arg == "-v":
            index += 1
            continue
        if arg == "-e":
            source = "env"
            value = ""
            index += 1
            continue
        if arg == "-p":
            if index + 1 >= len(argv):
                return _usage()
            source = "arg"
            value = argv[index + 1]
            index += 2
            continue
        if arg.startswith("-p") and arg != "-P":
            source = "arg"
            value = arg[2:]
            index += 1
            continue
        if arg == "-f":
            if index + 1 >= len(argv):
                return _usage()
            source = "file"
            value = argv[index + 1]
            index += 2
            continue
        if arg.startswith("-f"):
            source = "file"
            value = arg[2:]
            index += 1
            continue
        if arg == "-d":
            if index + 1 >= len(argv):
                return _usage()
            source = "fd"
            value = argv[index + 1]
            index += 2
            continue
        if arg.startswith("-d"):
            source = "fd"
            value = arg[2:]
            index += 1
            continue
        if arg == "-P":
            if index + 1 >= len(argv):
                return _usage()
            index += 2
            continue
        if arg.startswith("-P"):
            index += 1
            continue
        return source, value, argv[index:]
    return source, value, []


def _write_askpass(tmp_dir: Path, password: str) -> Path:
    password_path = tmp_dir / "password"
    askpass_path = tmp_dir / "askpass"
    password_path.write_text(password, encoding="utf-8")
    askpass_path.write_text(
        "#!/bin/sh\\n"
        'script_dir="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"\\n'
        'exec cat "${script_dir}/password"\\n',
        encoding="utf-8",
    )
    password_path.chmod(0o600)
    askpass_path.chmod(0o700)
    return askpass_path


def _tmp_candidates() -> list[Path]:
    raw_candidates = [
        os.getenv("INFINITO_SSHPASS_TMPDIR", ""),
        "/run/sudo",
        "/dev/shm",
        tempfile.gettempdir(),
    ]
    seen: set[str] = set()
    candidates: list[Path] = []
    for raw in raw_candidates:
        candidate = str(raw or "").strip()
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        candidates.append(Path(candidate))
    return candidates


def _create_tmp_dir() -> Path:
    last_error: Exception | None = None
    for base_dir in _tmp_candidates():
        try:
            base_dir.mkdir(parents=True, exist_ok=True)
            return Path(
                tempfile.mkdtemp(prefix="infinito-sshpass-", dir=str(base_dir))
            )
        except Exception as exc:
            last_error = exc
            continue
    if last_error is not None:
        raise last_error
    raise RuntimeError("no writable directory available for sshpass shim")


def main(argv: list[str]) -> int:
    parsed = _parse(argv)
    if isinstance(parsed, int):
        return parsed
    source, value, command = parsed
    if not command:
        return _usage()
    if source is None:
        print("sshpass: no password source provided", file=sys.stderr)
        return 1

    try:
        password = _normalize_password(_read_password(source, value))
    except Exception as exc:
        print(f"sshpass: {exc}", file=sys.stderr)
        return 1

    tmp_dir = _create_tmp_dir()
    try:
        askpass_path = _write_askpass(tmp_dir, password)
        env = os.environ.copy()
        env["SSH_ASKPASS"] = str(askpass_path)
        env["SSH_ASKPASS_REQUIRE"] = "force"
        env.setdefault("DISPLAY", "infinito-sshpass:0")
        completed = subprocess.run(command, env=env, stdin=subprocess.DEVNULL)
        return completed.returncode
    except FileNotFoundError as exc:
        print(f"sshpass: failed to execute {command[0]}: {exc}", file=sys.stderr)
        return 127
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
"""

CONTROLLER_COMMAND_SHIMS = (
    "baudolo",
    "cleanback",
    "dockreap",
    "gitcon",
    "ldapsm",
    "setup-hibernate",
)


def write_controller_shims(dest_root: Path) -> None:
    baudolo_seed_path = dest_root / "baudolo-seed"
    atomic_write_text(baudolo_seed_path, BAUDOLO_SEED_SHIM)
    baudolo_seed_path.chmod(0o755)

    controller_bin_dir = dest_root / "controller-bin"
    controller_bin_dir.mkdir(parents=True, exist_ok=True)
    for command in CONTROLLER_COMMAND_SHIMS:
        shim_path = controller_bin_dir / command
        atomic_write_text(
            shim_path,
            CONTROLLER_COMMAND_SHIM.format(command=command),
        )
        shim_path.chmod(0o755)

    sshpass_path = controller_bin_dir / "sshpass"
    atomic_write_text(sshpass_path, SSHPASS_SHIM)
    sshpass_path.chmod(0o755)


def write_runtime_command_shims(dest_root: Path) -> None:
    ssh_keyscan_path = dest_root / "ssh-keyscan"
    atomic_write_text(ssh_keyscan_path, SSH_KEYSCAN_SHIM)
    ssh_keyscan_path.chmod(0o755)


def write_infinito_shim(job_dir: Path) -> None:
    shim_path = job_dir / "infinito"
    if shim_path.exists():
        return
    atomic_write_text(shim_path, INFINITO_SHIM)
    # The shim is created by the API user but executed by runner-manager via
    # the shared infinito-manager group.
    shim_path.chmod(0o750)


def write_local_sudo_shim(job_dir: Path) -> None:
    shim_path = job_dir / "sudo"
    atomic_write_text(shim_path, LOCAL_SUDO_SHIM)
    shim_path.chmod(0o750)
