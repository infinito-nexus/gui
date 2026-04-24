from __future__ import annotations

import os
import signal
import subprocess
import threading
import time
from pathlib import Path
from typing import Dict, Iterable, Optional

from .util import atomic_write_text
from .secrets import mask_secrets


def write_runner_script(path: Path) -> None:
    """
    Generate a reusable CLI wrapper script.
    """
    script = """#!/usr/bin/env bash
set -euo pipefail

log_cmd() {
  printf '+'
  for arg in "$@"; do
    printf ' %q' "$arg"
  done
  printf '\\n'
}

run_cmd() {
  log_cmd "$@"
  if command -v stdbuf >/dev/null 2>&1; then
    stdbuf -oL -eL "$@"
  else
    "$@"
  fi
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH}"
export PATH="${SCRIPT_DIR}:${PATH}"

echo "+ pwd"
pwd

echo "+ ls -la"
ls -la

if [ "$#" -gt 0 ]; then
  run_cmd "$@"
  exit $?
fi

if [ -n "${RUNNER_CMD:-}" ]; then
  run_cmd /bin/bash -lc "${RUNNER_CMD}"
  exit $?
fi

if command -v ansible-playbook >/dev/null 2>&1 && [ -f "./playbook.yml" ]; then
  run_cmd ansible-playbook -i inventory.yml playbook.yml
  exit $?
fi

echo "No command provided. Set RUNNER_CMD or pass a command to this script."
exit 1
"""
    atomic_write_text(path, script)
    # The runner-manager process executes this script via the shared
    # infinito-manager group, while the file itself is created by the API user.
    path.chmod(0o750)


def runner_env() -> Dict[str, str]:
    env = dict(os.environ)
    env.setdefault("STATE_DIR", env.get("STATE_DIR", "/state"))
    repo_root = (env.get("INFINITO_REPO_PATH") or "").strip()
    if repo_root:
        py_path = env.get("PYTHONPATH") or ""
        if repo_root not in py_path.split(os.pathsep):
            env["PYTHONPATH"] = (
                f"{repo_root}{os.pathsep}{py_path}" if py_path else repo_root
            )
    return env


def _split_stream_buffer(buffer: str) -> tuple[list[str], str]:
    lines: list[str] = []
    while True:
        idx_n = buffer.find("\n")
        idx_r = buffer.find("\r")

        if idx_n == -1 and idx_r == -1:
            break

        if idx_n == -1:
            idx = idx_r
        elif idx_r == -1:
            idx = idx_n
        else:
            idx = idx_n if idx_n < idx_r else idx_r

        lines.append(buffer[:idx])
        buffer = buffer[idx + 1 :]

    return lines, buffer


def start_process(
    *,
    run_path: Path,
    cwd: Path,
    log_path: Path,
    secrets: Iterable[str] | None = None,
    on_line=None,
    args: Iterable[str] | None = None,
) -> tuple[subprocess.Popen, object, threading.Thread]:
    """
    Start the runner in its own process group so cancellation can kill the group.
    """
    log_fh = open(log_path, "a", encoding="utf-8", buffering=1)
    cmd = ["/bin/bash", str(run_path)]
    if args:
        cmd.extend(list(args))

    proc = subprocess.Popen(
        cmd,
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=False,
        bufsize=0,
        env=runner_env(),
        start_new_session=True,  # new process group/session
    )

    def _reader() -> None:
        if proc.stdout is None:
            return
        buf = ""
        secrets_list = list(secrets or [])

        def _emit(raw_line: str) -> None:
            masked = mask_secrets(raw_line, secrets_list)
            prefixed = f"[RX:{int(time.time() * 1000)}] {masked}"
            log_fh.write(prefixed + "\n")
            if on_line is not None:
                try:
                    on_line(prefixed)
                except Exception:
                    pass

        try:
            while True:
                chunk = os.read(proc.stdout.fileno(), 4096)
                if not chunk:
                    break
                buf += chunk.decode("utf-8", errors="replace")
                lines, buf = _split_stream_buffer(buf)
                for line in lines:
                    _emit(line)
            if buf:
                _emit(buf)
        finally:
            try:
                proc.stdout.close()
            except Exception:
                pass

    reader = threading.Thread(target=_reader, daemon=True)
    reader.start()

    return proc, log_fh, reader


def terminate_process_group(pid: Optional[int]) -> None:
    if not isinstance(pid, int) or pid <= 0:
        return
    try:
        os.killpg(pid, signal.SIGTERM)
    except Exception:
        # Best-effort; ignore failures (already gone / permission)
        return
