from __future__ import annotations

import importlib
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from fastapi import HTTPException


def _root():
    return importlib.import_module("services.job_runner.container_runner")


def _parse_mount_target(spec: str) -> str | None:
    parts = str(spec or "").split(":")
    if len(parts) < 2:
        return None
    target = str(parts[1] or "").strip()
    return target or None


def _declared_mount_targets(extra_args: List[str]) -> set[str]:
    targets: set[str] = set()
    index = 0
    while index < len(extra_args):
        arg = str(extra_args[index] or "").strip()
        spec = ""
        if arg in {"-v", "--volume"} and index + 1 < len(extra_args):
            spec = str(extra_args[index + 1] or "")
            index += 1
        elif arg.startswith("--volume="):
            spec = arg.split("=", 1)[1]
        elif arg.startswith("-v") and len(arg) > 2:
            spec = arg[2:]

        target = _parse_mount_target(spec)
        if target:
            targets.add(target)
        index += 1

    return targets


def build_container_command(
    *,
    job_id: str,
    job_dir: Path,
    cli_args: List[str],
    runtime_env: Optional[Dict[str, str]] = None,
    cfg=None,
    labels: Optional[Dict[str, str]] = None,
    network_name: Optional[str] = None,
    container_user: Optional[str] = None,
    read_only_root: bool = False,
    tmpfs_mounts: Optional[List[str]] = None,
    bind_mounts: Optional[List[Tuple[str, str, bool]]] = None,
    volume_mounts: Optional[List[Tuple[str, str, bool]]] = None,
    hardened: bool = False,
):
    root = _root()
    cfg = cfg or root.load_container_config()
    docker_bin = root.resolve_docker_bin()
    host_job_dir = root.resolve_host_job_dir(job_dir)

    container_name = f"infinito-job-{job_id}"
    workspace_inventory = f"{cfg.workdir.rstrip('/')}/inventory.yml"
    inner_cmd = f"""set -euo pipefail
export PATH={root.shlex.quote(cfg.workdir)}:$PATH
secrets_dir="${{INFINITO_SECRETS_DIR:-}}"
runtime_python="${{PYTHON:-/opt/venvs/infinito/bin/python}}"
if [ ! -x "${{runtime_python}}" ]; then
  runtime_python="$(command -v python3 || command -v python)"
fi
runtime_bin_dir="$(dirname "${{runtime_python}}")"
runtime_home="/tmp/infinito-home"
mkdir -p "${{runtime_home}}/.ansible/tmp" "${{runtime_home}}/.cache"
chmod 700 "${{runtime_home}}" "${{runtime_home}}/.ansible" "${{runtime_home}}/.ansible/tmp" "${{runtime_home}}/.cache"
export HOME="${{runtime_home}}"
export XDG_CACHE_HOME="${{runtime_home}}/.cache"
export ANSIBLE_LOCAL_TEMP="${{runtime_home}}/.ansible/tmp"
export TMPDIR=/tmp
export PATH={root.shlex.quote(cfg.workdir)}:"${{runtime_bin_dir}}":$PATH
source_repo_root="${{JOB_RUNNER_REPO_DIR:-{root.shlex.quote(cfg.repo_dir)}}}"
repo_root="${{source_repo_root}}"
if [ ! -w "${{source_repo_root}}" ]; then
  runtime_repo_root="/run/infinito-repo/repo"
  rm -rf "${{runtime_repo_root}}"
  mkdir -p "${{runtime_repo_root}}"
  cp -a "${{source_repo_root}}/." "${{runtime_repo_root}}/"
  if [ -d "${{runtime_repo_root}}/scripts" ]; then
    find "${{runtime_repo_root}}/scripts" -type f -name '*.sh' -exec chmod 755 {{}} +
  fi
  repo_root="${{runtime_repo_root}}"
fi
export JOB_RUNNER_REPO_DIR="${{repo_root}}"
export PYTHONPATH="${{repo_root}}"
cd "${{repo_root}}"
if ! "${{runtime_python}}" -c "import yaml" >/dev/null 2>&1; then
  "${{runtime_python}}" -m pip install --disable-pip-version-check --no-cache-dir --break-system-packages pyyaml
fi
workspace_inventory={root.shlex.quote(workspace_inventory)}
workspace_inventory_root="$(dirname "${{workspace_inventory}}")"
runtime_inventory_root="/run/inventory"
runtime_inventory_file="${{runtime_inventory_root}}/inventory.yml"
runtime_group_vars_dir="${{runtime_inventory_root}}/group_vars"
runtime_host_vars_dir="${{runtime_inventory_root}}/host_vars"
runtime_secrets_dir="${{runtime_group_vars_dir}}/all"
runtime_secrets_file="${{runtime_secrets_dir}}/_secrets.yml"
runtime_vars_file=""
runtime_ssh_key_file=""
secrets_ready_file="${{INFINITO_SECRETS_READY_FILE:-${{secrets_dir}}/.ready}}"
cleanup() {{
  if [ -n "${{runtime_vars_file}}" ] && [ -f "${{runtime_vars_file}}" ]; then
    rm -f "${{runtime_vars_file}}"
  fi
  if [ -n "${{runtime_ssh_key_file}}" ] && [ -f "${{runtime_ssh_key_file}}" ]; then
    rm -f "${{runtime_ssh_key_file}}"
  fi
  if [ -d "${{runtime_host_vars_dir:-}}" ]; then
    rm -rf "${{runtime_host_vars_dir}}"
  fi
  if [ -d "${{runtime_group_vars_dir:-}}" ]; then
    rm -rf "${{runtime_group_vars_dir}}"
  fi
  if [ -n "${{runtime_secrets_file:-}}" ] && [ -f "${{runtime_secrets_file}}" ]; then
    rm -f "${{runtime_secrets_file}}"
  fi
  if [ -n "${{runtime_inventory_file:-}}" ] && [ -e "${{runtime_inventory_file}}" ]; then
    rm -f "${{runtime_inventory_file}}"
  fi
  if [ -n "${{runtime_vault_file:-}}" ] && [ -f "${{runtime_vault_file}}" ]; then
    rm -f "${{runtime_vault_file}}"
  fi
  if [ -n "${{secrets_ready_file:-}}" ] && [ -f "${{secrets_ready_file}}" ]; then
    rm -f "${{secrets_ready_file}}"
  fi
}}
trap cleanup EXIT
if [ -n "${{secrets_dir}}" ] && [ "${{INFINITO_WAIT_FOR_SECRETS_READY:-0}}" = "1" ]; then
  ready_timeout="${{INFINITO_SECRETS_READY_TIMEOUT_SECONDS:-10}}"
  ready_deadline="$(( $(date +%s) + ready_timeout ))"
  while [ ! -f "${{secrets_ready_file}}" ]; do
    if [ "$(date +%s)" -ge "${{ready_deadline}}" ]; then
      echo "ERROR: timed out waiting for runner secrets bootstrap at ${{secrets_ready_file}}" >&2
      exit 1
    fi
    sleep 0.1
  done
fi
if [ -n "${{secrets_dir}}" ] && [ -f "${{secrets_dir}}/vault_password" ]; then
  export ANSIBLE_VAULT_PASSWORD_FILE="${{secrets_dir}}/vault_password"
elif [ -n "${{INFINITO_RUNTIME_VAULT_PASSWORD:-}}" ]; then
  runtime_vault_file="/tmp/infinito-runtime-vault.pass"
  printf '%s' "${{INFINITO_RUNTIME_VAULT_PASSWORD}}" > "${{runtime_vault_file}}"
  chmod 600 "${{runtime_vault_file}}"
  export ANSIBLE_VAULT_PASSWORD_FILE="${{runtime_vault_file}}"
fi
if [ -n "${{secrets_dir}}" ]; then
  mkdir -p "${{runtime_group_vars_dir}}" "${{runtime_host_vars_dir}}" "${{runtime_secrets_dir}}"
  chmod 700 "${{runtime_inventory_root}}" "${{runtime_group_vars_dir}}" "${{runtime_host_vars_dir}}" "${{runtime_secrets_dir}}"
  if [ -r "${{secrets_dir}}/ssh_key" ]; then
    runtime_ssh_key_file="/tmp/infinito-runtime-ssh-key"
    cp "${{secrets_dir}}/ssh_key" "${{runtime_ssh_key_file}}"
    chmod 400 "${{runtime_ssh_key_file}}"
    export INFINITO_RUNTIME_SSH_KEY_FILE="${{runtime_ssh_key_file}}"
  fi
  if [ -f "${{workspace_inventory}}" ]; then
    cp "${{workspace_inventory}}" "${{runtime_inventory_file}}"
  fi
  if [ -d "${{workspace_inventory_root}}/host_vars" ]; then
    cp -a "${{workspace_inventory_root}}/host_vars/." "${{runtime_host_vars_dir}}/"
  fi
  if [ -d "${{workspace_inventory_root}}/group_vars" ]; then
    cp -a "${{workspace_inventory_root}}/group_vars/." "${{runtime_group_vars_dir}}/"
    mkdir -p "${{runtime_secrets_dir}}"
  fi
  "${{runtime_python}}" - "${{runtime_secrets_file}}" <<'PY'
import os
import sys
from pathlib import Path

path = Path(sys.argv[1])
secrets_dir = Path(os.getenv("INFINITO_SECRETS_DIR") or "")
runtime_ssh_key_file = str(os.getenv("INFINITO_RUNTIME_SSH_KEY_FILE") or "").strip()
lines: list[str] = []


def has_secret(name: str) -> bool:
    try:
        return secrets_dir.joinpath(name).is_file()
    except PermissionError:
        return False


if runtime_ssh_key_file:
    lines.append(f"ansible_ssh_private_key_file: {{runtime_ssh_key_file}}")
elif has_secret("ssh_key"):
    lines.append("ansible_ssh_private_key_file: /run/secrets/infinito/ssh_key")
if has_secret("ssh_password"):
    lines.append(
        "ansible_password: \\"{{{{ lookup('file', '/run/secrets/infinito/ssh_password') }}}}\\""
    )
    lines.append(
        "ansible_ssh_pass: \\"{{{{ lookup('file', '/run/secrets/infinito/ssh_password') }}}}\\""
    )
    lines.append(
        "ansible_become_pass: \\"{{{{ lookup('file', '/run/secrets/infinito/ssh_password') }}}}\\""
    )
    lines.append(
        "ansible_become_password: \\"{{{{ lookup('file', '/run/secrets/infinito/ssh_password') }}}}\\""
    )
if has_secret("vault_password"):
    lines.append("infinito_vault_password_file: /run/secrets/infinito/vault_password")

if lines:
    path.write_text("\\n".join(lines) + "\\n", encoding="utf-8")
PY
  if [ -f "${{runtime_secrets_file}}" ]; then
    chmod 400 "${{runtime_secrets_file}}"
  fi
fi
if [ -f "${{runtime_inventory_file}}" ]; then
  rewritten_args=()
  for arg in "$@"; do
    if [ "${{arg}}" = "${{workspace_inventory}}" ]; then
      rewritten_args+=("${{runtime_inventory_file}}")
    else
      rewritten_args+=("${{arg}}")
    fi
  done
  set -- "${{rewritten_args[@]}}"
fi
if [ -n "${{INFINITO_RUNTIME_PASSWORD:-}}" ] || [ -n "${{INFINITO_RUNTIME_SSH_PASS:-}}" ] || [ -n "${{secrets_dir}}" ]; then
  runtime_vars_file="/tmp/infinito-runtime-vars.json"
  "${{runtime_python}}" - "${{runtime_vars_file}}" <<'PY'
import json
import os
import sys
from pathlib import Path

path = sys.argv[1]
data = {{}}
secrets_dir = Path(os.getenv("INFINITO_SECRETS_DIR") or "")


def read_secret(name: str) -> str:
    if not secrets_dir:
        return ""
    candidate = secrets_dir / name
    try:
        if not candidate.is_file():
            return ""
        return candidate.read_text(encoding="utf-8").strip()
    except PermissionError:
        return ""


password = read_secret("ssh_password") or os.getenv("INFINITO_RUNTIME_PASSWORD")
ssh_pass = read_secret("ssh_password") or os.getenv("INFINITO_RUNTIME_SSH_PASS")
if password:
    data["ansible_password"] = password
    data["ansible_become_password"] = password
if ssh_pass:
    data["ansible_ssh_pass"] = ssh_pass
with open(path, "w", encoding="utf-8") as handle:
    json.dump(data, handle)
PY
  chmod 600 "${{runtime_vars_file}}"
  if [ -s "${{runtime_vars_file}}" ] && [ -z "${{secrets_dir}}" ]; then
    exec "$@" -e "@${{runtime_vars_file}}"
  fi
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

    effective_network = network_name or cfg.network
    _validate_hardened_container_request(
        hardened=hardened,
        effective_network=effective_network,
        extra_args=cfg.extra_args,
        bind_mounts=bind_mounts or [],
        volume_mounts=volume_mounts or [],
    )
    if effective_network:
        cmd.extend(["--network", effective_network])

    if cfg.extra_args:
        cmd.extend(cfg.extra_args)

    claimed_targets = _declared_mount_targets(cfg.extra_args)

    if hardened:
        cmd.extend(["--cap-drop", "ALL"])
        cmd.extend(["--security-opt", "no-new-privileges:true"])

    if container_user:
        cmd.extend(["--user", container_user])

    if read_only_root:
        cmd.append("--read-only")

    for tmpfs in tmpfs_mounts or []:
        cmd.extend(["--tmpfs", tmpfs])

    for key, value in sorted((labels or {}).items()):
        cmd.extend(["--label", f"{key}={value}"])

    cmd.extend(["-v", f"{host_job_dir}:{cfg.workdir}"])

    baudolo_seed_job = job_dir / "baudolo-seed"
    baudolo_seed_host = host_job_dir / "baudolo-seed"
    if (
        baudolo_seed_job.is_file()
        and "/usr/local/bin/baudolo-seed" not in claimed_targets
    ):
        cmd.extend(["-v", f"{baudolo_seed_host}:/usr/local/bin/baudolo-seed:ro"])
        claimed_targets.add("/usr/local/bin/baudolo-seed")

    controller_bin_job_dir = job_dir / "controller-bin"
    controller_bin_host_dir = host_job_dir / "controller-bin"
    if controller_bin_job_dir.is_dir():
        for shim_path in sorted(controller_bin_job_dir.iterdir()):
            if not shim_path.is_file():
                continue
            target = f"/usr/bin/{shim_path.name}"
            if target in claimed_targets:
                continue
            cmd.extend(
                [
                    "-v",
                    f"{controller_bin_host_dir / shim_path.name}:{target}:ro",
                ]
            )
            claimed_targets.add(target)

    passwd_job = job_dir / "runner-passwd"
    passwd_host = host_job_dir / "runner-passwd"
    if passwd_job.is_file() and "/etc/passwd" not in claimed_targets:
        cmd.extend(["-v", f"{passwd_host}:/etc/passwd:ro"])
        claimed_targets.add("/etc/passwd")

    group_job = job_dir / "runner-group"
    group_host = host_job_dir / "runner-group"
    if group_job.is_file() and "/etc/group" not in claimed_targets:
        cmd.extend(["-v", f"{group_host}:/etc/group:ro"])
        claimed_targets.add("/etc/group")

    sudoers_job = job_dir / "runner-sudoers"
    sudoers_host = host_job_dir / "runner-sudoers"
    sudoers_target = "/etc/sudoers.d/infinito-runner"
    if sudoers_job.is_file() and sudoers_target not in claimed_targets:
        cmd.extend(["-v", f"{sudoers_host}:{sudoers_target}:ro"])
        claimed_targets.add(sudoers_target)

    for source, target, is_read_only in bind_mounts or []:
        host_source = root.resolve_host_mount_source(source)
        mount_value = f"{host_source}:{target}"
        if is_read_only:
            mount_value = f"{mount_value}:ro"
        cmd.extend(["-v", mount_value])

    for volume_name, target, is_read_only in volume_mounts or []:
        mount_value = f"{volume_name}:{target}"
        if is_read_only:
            mount_value = f"{mount_value}:ro"
        cmd.extend(["-v", mount_value])

    for key, value in (runtime_env or {}).items():
        key_name = str(key or "").strip()
        if key_name and str(value or ""):
            cmd.extend(["-e", f"{key_name}={value}"])

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


def _validate_hardened_container_request(
    *,
    hardened: bool,
    effective_network: Optional[str],
    extra_args: List[str],
    bind_mounts: List[Tuple[str, str, bool]],
    volume_mounts: List[Tuple[str, str, bool]],
) -> None:
    root = _root()
    if not hardened:
        return

    if (effective_network or "").strip().lower() == "host":
        raise HTTPException(
            status_code=500,
            detail="runner containers must not use host networking",
        )

    lowered_args = [str(arg or "").strip() for arg in extra_args]
    for index, arg in enumerate(lowered_args):
        if not arg:
            continue
        lower = arg.lower()
        if lower in root.DISALLOWED_HARDENED_FLAGS:
            raise HTTPException(
                status_code=500,
                detail=f"runner hardening forbids docker arg {arg}",
            )
        if any(
            lower.startswith(f"{flag}=")
            for flag in root.DISALLOWED_HARDENED_FLAGS
            if flag != "--privileged"
        ):
            raise HTTPException(
                status_code=500,
                detail=f"runner hardening forbids docker arg {arg}",
            )
        if lower == "--pid" and index + 1 < len(lowered_args):
            if lowered_args[index + 1].strip().lower() == "host":
                raise HTTPException(
                    status_code=500,
                    detail="runner hardening forbids host pid namespace",
                )
        if lower.startswith("--pid=") and lower.endswith("host"):
            raise HTTPException(
                status_code=500,
                detail="runner hardening forbids host pid namespace",
            )
        if lower == "--network" and index + 1 < len(lowered_args):
            raise HTTPException(
                status_code=500,
                detail="runner hardening forbids overriding the dedicated job network",
            )
        if lower.startswith("--network="):
            raise HTTPException(
                status_code=500,
                detail="runner hardening forbids overriding the dedicated job network",
            )
        if lower in {"-v", "--volume", "--mount"} and index + 1 < len(lowered_args):
            _reject_docker_socket_mount(lowered_args[index + 1])
        if lower.startswith("-v") and lower != "-v":
            _reject_docker_socket_mount(lower)
        if lower.startswith("--volume=") or lower.startswith("--mount="):
            _reject_docker_socket_mount(lower)

    for source, target, _is_read_only in bind_mounts:
        _reject_docker_socket_mount(source)
        _reject_docker_socket_mount(target)

    for volume_name, target, _is_read_only in volume_mounts:
        _reject_docker_socket_mount(volume_name)
        _reject_docker_socket_mount(target)


def _reject_docker_socket_mount(value: str) -> None:
    if "/var/run/docker.sock" not in str(value or ""):
        return
    raise HTTPException(
        status_code=500,
        detail="runner hardening forbids docker socket mounts",
    )
