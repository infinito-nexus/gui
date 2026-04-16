from __future__ import annotations

import os
import shlex
import subprocess
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from fastapi import HTTPException

from .config import env_bool


@dataclass(frozen=True)
class ContainerRunnerConfig:
    image: str
    repo_dir: str
    workdir: str
    network: Optional[str]
    extra_args: List[str]
    skip_cleanup: bool
    skip_build: bool


def _require_absolute(path: str, label: str) -> Path:
    p = Path(path)
    if not p.is_absolute():
        raise HTTPException(
            status_code=500,
            detail=f"{label} must be an absolute path for containerized jobs",
        )
    return p


def load_container_config() -> ContainerRunnerConfig:
    image = (
        os.getenv("JOB_RUNNER_IMAGE") or os.getenv("INFINITO_NEXUS_IMAGE") or ""
    ).strip()
    if not image:
        raise HTTPException(
            status_code=500,
            detail="JOB_RUNNER_IMAGE (or INFINITO_NEXUS_IMAGE) must be set for container runner",
        )

    repo_dir = (
        os.getenv("JOB_RUNNER_REPO_DIR")
        or os.getenv("INFINITO_SRC_DIR")
        or "/opt/src/infinito"
    ).strip()
    workdir = (os.getenv("JOB_RUNNER_WORKDIR") or "/workspace").strip()

    network = (os.getenv("DOCKER_NETWORK_NAME") or "").strip() or None
    extra_raw = (os.getenv("JOB_RUNNER_DOCKER_ARGS") or "").strip()
    extra_args = shlex.split(extra_raw) if extra_raw else []

    return ContainerRunnerConfig(
        image=image,
        repo_dir=repo_dir,
        workdir=workdir,
        network=network,
        extra_args=extra_args,
        skip_cleanup=env_bool("JOB_RUNNER_SKIP_CLEANUP", False),
        skip_build=env_bool("JOB_RUNNER_SKIP_BUILD", False),
    )


def resolve_docker_bin() -> str:
    preferred = (os.getenv("JOB_RUNNER_DOCKER_BIN") or "").strip()
    candidates = (
        [preferred, "docker", "docker.io"] if preferred else ["docker", "docker.io"]
    )
    for cand in candidates:
        if cand and shutil.which(cand):
            return cand
    raise HTTPException(
        status_code=500,
        detail=(
            "Docker CLI not found in PATH. Install docker-cli in the API container "
            "or set JOB_RUNNER_DOCKER_BIN to the correct binary name."
        ),
    )


def resolve_host_job_dir(job_dir: Path) -> Path:
    state_dir = Path((os.getenv("STATE_DIR") or "/state").strip())
    host_state = (os.getenv("STATE_HOST_PATH") or "").strip()
    if not host_state:
        raise HTTPException(
            status_code=500,
            detail="STATE_HOST_PATH must be set for container runner volume mounts",
        )
    host_state_path = _require_absolute(host_state, "STATE_HOST_PATH")
    try:
        rel = job_dir.relative_to(state_dir)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"job_dir is not inside STATE_DIR: {exc}",
        )
    return host_state_path / rel


def build_container_command(
    *,
    job_id: str,
    job_dir: Path,
    cli_args: List[str],
    runtime_env: Optional[Dict[str, str]] = None,
    cfg: Optional[ContainerRunnerConfig] = None,
) -> Tuple[List[str], str, ContainerRunnerConfig]:
    cfg = cfg or load_container_config()
    docker_bin = resolve_docker_bin()
    host_job_dir = resolve_host_job_dir(job_dir)

    container_name = f"infinito-job-{job_id}"
    inner_cmd = f"""set -euo pipefail
export PATH={shlex.quote(cfg.workdir)}:$PATH
if [ -x {shlex.quote(cfg.workdir)}/baudolo-seed ]; then
  ln -sf {shlex.quote(cfg.workdir)}/baudolo-seed /usr/local/bin/baudolo-seed
fi
runtime_python="${{PYTHON:-/opt/venvs/infinito/bin/python}}"
if [ ! -x "${{runtime_python}}" ]; then
  runtime_python="$(command -v python3 || command -v python)"
fi
runtime_bin_dir="$(dirname "${{runtime_python}}")"
export PATH={shlex.quote(cfg.workdir)}:"${{runtime_bin_dir}}":$PATH
repo_root="${{JOB_RUNNER_REPO_DIR:-{shlex.quote(cfg.repo_dir)}}}"
cd "${{repo_root}}"
if ! "${{runtime_python}}" -c "import yaml" >/dev/null 2>&1; then
  "${{runtime_python}}" -m pip install --disable-pip-version-check --no-cache-dir --break-system-packages pyyaml
fi
runtime_vars_file=""
cleanup() {{
  if [ -n "${{runtime_vars_file}}" ] && [ -f "${{runtime_vars_file}}" ]; then
    rm -f "${{runtime_vars_file}}"
  fi
  if [ -n "${{runtime_vault_file:-}}" ] && [ -f "${{runtime_vault_file}}" ]; then
    rm -f "${{runtime_vault_file}}"
  fi
}}
trap cleanup EXIT
if [ -n "${{INFINITO_RUNTIME_VAULT_PASSWORD:-}}" ]; then
  runtime_vault_file="/tmp/infinito-runtime-vault.pass"
  printf '%s' "${{INFINITO_RUNTIME_VAULT_PASSWORD}}" > "${{runtime_vault_file}}"
  chmod 600 "${{runtime_vault_file}}"
  export ANSIBLE_VAULT_PASSWORD_FILE="${{runtime_vault_file}}"
fi
if [ -n "${{INFINITO_RUNTIME_PASSWORD:-}}" ] || [ -n "${{INFINITO_RUNTIME_SSH_PASS:-}}" ]; then
  runtime_vars_file="/tmp/infinito-runtime-vars.json"
  "${{runtime_python}}" - "${{runtime_vars_file}}" <<'PY'
import json
import os
import sys

path = sys.argv[1]
data = {{}}
password = os.getenv("INFINITO_RUNTIME_PASSWORD")
ssh_pass = os.getenv("INFINITO_RUNTIME_SSH_PASS")
if password:
    data["ansible_password"] = password
    data["ansible_become_password"] = password
if ssh_pass:
    data["ansible_ssh_pass"] = ssh_pass
with open(path, "w", encoding="utf-8") as handle:
    json.dump(data, handle)
PY
  chmod 600 "${{runtime_vars_file}}"
  exec "$@" -e "@${{runtime_vars_file}}"
fi
exec "$@"
"""

    cmd: List[str] = [
        docker_bin,
        "run",
        "--rm",
        "--name",
        container_name,
    ]

    if cfg.network:
        cmd.extend(["--network", cfg.network])

    if cfg.extra_args:
        cmd.extend(cfg.extra_args)

    cmd.extend(["-v", f"{host_job_dir}:{cfg.workdir}"])

    for key, value in (runtime_env or {}).items():
        key_name = str(key or "").strip()
        if not key_name:
            continue
        value_text = str(value or "")
        if not value_text:
            continue
        cmd.extend(["-e", f"{key_name}={value_text}"])

    cmd.extend(
        [
            "-e",
            f"JOB_RUNNER_REPO_DIR={cfg.repo_dir}",
            "-e",
            f"PYTHONPATH={cfg.repo_dir}",
            "-e",
            "PYTHONUNBUFFERED=1",
            "-w",
            cfg.repo_dir,
            "--entrypoint",
            "/bin/bash",
            cfg.image,
            "-lc",
            inner_cmd,
            "container-runner",
            *cli_args,
        ]
    )

    return cmd, container_name, cfg


def stop_container(container_name: Optional[str]) -> None:
    name = (container_name or "").strip()
    if not name:
        return
    try:
        subprocess.run(
            ["docker", "stop", name],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except Exception:
        # Best-effort only
        return
