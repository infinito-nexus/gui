from __future__ import annotations

import json  # noqa: F401 - re-exported for runtime module via _root()
import os
import shlex
import shutil
import subprocess  # noqa: F401 - re-exported for test patchability
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from fastapi import HTTPException

from .config import env_bool

DISALLOWED_HARDENED_FLAGS = {
    "--privileged",
    "--cap-add",
    "--cap-drop",
    "--security-opt",
}


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
    candidate = Path(path)
    if not candidate.is_absolute():
        raise HTTPException(
            status_code=500,
            detail=f"{label} must be an absolute path for containerized jobs",
        )
    return candidate


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
    for candidate in candidates:
        if candidate and shutil.which(candidate):
            return candidate
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
        ) from exc
    return host_state_path / rel


def resolve_host_mount_source(source: str) -> str:
    source_path = _require_absolute(source, "bind mount source")
    state_dir = Path((os.getenv("STATE_DIR") or "/state").strip())
    host_state = (os.getenv("STATE_HOST_PATH") or "").strip()
    if not host_state:
        return str(source_path)

    host_state_path = _require_absolute(host_state, "STATE_HOST_PATH")
    try:
        rel = source_path.relative_to(state_dir)
    except Exception:
        return str(source_path)
    return str(host_state_path / rel)


from .container_runner_command import build_container_command  # noqa: E402
from .container_runner_runtime import (  # noqa: E402
    create_internal_network,
    create_tmpfs_volume,
    inspect_container_labels,
    remove_container,
    remove_network,
    remove_volume,
    stop_container,
)

__all__ = [
    "ContainerRunnerConfig",
    "DISALLOWED_HARDENED_FLAGS",
    "build_container_command",
    "create_internal_network",
    "create_tmpfs_volume",
    "inspect_container_labels",
    "load_container_config",
    "remove_container",
    "remove_network",
    "remove_volume",
    "resolve_docker_bin",
    "resolve_host_job_dir",
    "resolve_host_mount_source",
    "stop_container",
]
