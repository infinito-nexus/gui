from __future__ import annotations

import importlib

from fastapi import HTTPException


def _root():
    return importlib.import_module("services.job_runner.container_runner")


def stop_container(container_name):
    root = _root()
    name = str(container_name or "").strip()
    if not name:
        return
    try:
        root.subprocess.run(
            ["docker", "stop", "--time", "10", name],
            stdout=root.subprocess.DEVNULL,
            stderr=root.subprocess.DEVNULL,
            check=False,
        )
    except Exception:
        return


def remove_container(container_name):
    root = _root()
    name = str(container_name or "").strip()
    if not name:
        return
    try:
        root.subprocess.run(
            ["docker", "rm", "-f", name],
            stdout=root.subprocess.DEVNULL,
            stderr=root.subprocess.DEVNULL,
            check=False,
        )
    except Exception:
        return


def create_tmpfs_volume(
    volume_name,
    *,
    size_mebibytes: int = 8,
    uid: int = 10002,
    gid: int = 10002,
    mode: str = "0700",
) -> None:
    root = _root()
    name = str(volume_name or "").strip()
    if not name:
        return
    result = root.subprocess.run(
        [
            root.resolve_docker_bin(),
            "volume",
            "create",
            "--driver",
            "local",
            "--opt",
            "type=tmpfs",
            "--opt",
            "device=tmpfs",
            "--opt",
            f"o=size={max(int(size_mebibytes), 1)}m,uid={uid},gid={gid},mode={mode},noexec,nosuid,nodev",
            name,
        ],
        stdout=root.subprocess.PIPE,
        stderr=root.subprocess.PIPE,
        text=True,
        check=False,
    )
    if result.returncode == 0:
        return
    detail = (result.stderr or result.stdout or "").strip() or "unknown docker error"
    raise HTTPException(
        status_code=500,
        detail=f"failed to create runner secret volume {name}: {detail}",
    )


def remove_volume(volume_name, *, timeout_seconds: float = 5.0) -> None:
    root = _root()
    name = str(volume_name or "").strip()
    if not name:
        return
    deadline = root.time.monotonic() + max(float(timeout_seconds), 0.1)
    while True:
        try:
            result = root.subprocess.run(
                [root.resolve_docker_bin(), "volume", "rm", name],
                stdout=root.subprocess.DEVNULL,
                stderr=root.subprocess.PIPE,
                text=True,
                check=False,
            )
        except Exception:
            return
        if result.returncode == 0:
            return
        detail = str(result.stderr or "").strip().lower()
        if "no such volume" in detail or root.time.monotonic() >= deadline:
            return
        root.time.sleep(0.1)


def create_internal_network(network_name) -> None:
    root = _root()
    name = str(network_name or "").strip()
    if not name:
        return
    try:
        result = root.subprocess.run(
            ["docker", "network", "create", "--driver", "bridge", "--internal", name],
            stdout=root.subprocess.DEVNULL,
            stderr=root.subprocess.PIPE,
            text=True,
            check=False,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"failed to create runner network {name}: {exc}",
        ) from exc
    if result.returncode != 0:
        detail = str(result.stderr or "").strip() or "unknown docker error"
        raise HTTPException(
            status_code=500,
            detail=f"failed to create runner network {name}: {detail}",
        )


def remove_network(network_name) -> None:
    root = _root()
    name = str(network_name or "").strip()
    if not name:
        return
    try:
        root.subprocess.run(
            ["docker", "network", "rm", name],
            stdout=root.subprocess.DEVNULL,
            stderr=root.subprocess.DEVNULL,
            check=False,
        )
    except Exception:
        return


def inspect_container_labels(container_name) -> dict[str, str]:
    root = _root()
    name = str(container_name or "").strip()
    if not name:
        return {}
    try:
        result = root.subprocess.run(
            ["docker", "inspect", "--format", "{{json .Config.Labels}}", name],
            stdout=root.subprocess.PIPE,
            stderr=root.subprocess.DEVNULL,
            text=True,
            check=False,
        )
    except Exception:
        return {}
    if result.returncode != 0:
        return {}
    raw = str(result.stdout or "").strip()
    if not raw or raw == "<no value>":
        return {}
    try:
        labels = root.json.loads(raw)
    except root.json.JSONDecodeError:
        return {}
    if not isinstance(labels, dict):
        return {}
    return {
        str(key).strip(): str(value).strip()
        for key, value in labels.items()
        if str(key).strip()
    }
