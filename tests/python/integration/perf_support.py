from __future__ import annotations

import json
import math
import os
import subprocess
import time
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parents[3]
PERF_OUTPUT_DIR = REPO_ROOT / "state" / "perf" / "016"


def _docker_env() -> dict[str, str]:
    env = dict(os.environ)
    socket_path = str(env.get("DOCKER_SOCKET_PATH") or "/var/run/docker.sock").strip()
    env.setdefault("DOCKER_SOCKET_PATH", socket_path)
    try:
        socket_gid = str(os.stat(socket_path).st_gid)
    except OSError:
        socket_gid = str(env.get("DOCKER_SOCKET_GID") or "10900").strip() or "10900"
    env["DOCKER_SOCKET_GID"] = socket_gid
    return env


def api_base_url() -> str:
    port = str(os.getenv("API_PORT") or "8000").strip() or "8000"
    return f"http://127.0.0.1:{port}"


def web_base_url() -> str:
    port = str(os.getenv("WEB_PORT") or "3000").strip() or "3000"
    return f"http://127.0.0.1:{port}"


def roles_catalog_host_path() -> Path:
    state_host_path = str(os.getenv("STATE_HOST_PATH") or "").strip()
    if state_host_path:
        return Path(state_host_path) / "catalog" / "roles" / "list.json"
    return REPO_ROOT / "state" / "catalog" / "roles" / "list.json"


def ensure_perf_output_dir() -> Path:
    PERF_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    return PERF_OUTPUT_DIR


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return float(values[0])
    ordered = sorted(float(value) for value in values)
    rank = (len(ordered) - 1) * pct
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return ordered[int(rank)]
    lower_value = ordered[lower]
    upper_value = ordered[upper]
    return lower_value + (upper_value - lower_value) * (rank - lower)


def timing_summary(values: Iterable[float]) -> dict[str, float | int]:
    normalized = [float(value) for value in values]
    return {
        "p50": round(percentile(normalized, 0.50), 3),
        "p95": round(percentile(normalized, 0.95), 3),
        "p99": round(percentile(normalized, 0.99), 3),
        "max": round(max(normalized) if normalized else 0.0, 3),
        "count": len(normalized),
    }


def write_perf_result(
    test_name: str,
    *,
    samples: list[dict[str, Any]],
    thresholds: dict[str, dict[str, Any]],
    summary_values: Iterable[float],
    status: str,
    failure_messages: list[str] | None = None,
) -> Path:
    target = ensure_perf_output_dir() / f"{test_name}.json"
    payload = {
        "samples": samples,
        "summary": timing_summary(list(summary_values)),
        "thresholds": thresholds,
        "failure_messages": list(failure_messages or []),
        "status": status,
    }
    target.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return target


def wait_for_http_ready(url: str, *, timeout_seconds: float = 60.0) -> None:
    import httpx

    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with httpx.Client(timeout=5.0) as client:
                response = client.get(url)
            if response.status_code < 500:
                return
        except Exception as exc:  # pragma: no cover - exercised in integration only
            last_error = exc
        time.sleep(1.0)
    raise RuntimeError(f"timed out waiting for {url}: {last_error}")


def compose_ps_quiet(service: str) -> str:
    output = subprocess.check_output(
        [
            "docker",
            "compose",
            "--env-file",
            str(REPO_ROOT / ".env"),
            "-f",
            str(REPO_ROOT / "docker-compose.yml"),
            "--profile",
            "test",
            "ps",
            "-q",
            service,
        ],
        cwd=str(REPO_ROOT),
        text=True,
        env=_docker_env(),
    )
    return output.strip()


def docker_inspect_started_at(container_id: str) -> str:
    output = subprocess.check_output(
        ["docker", "inspect", "-f", "{{.State.StartedAt}}", container_id],
        cwd=str(REPO_ROOT),
        text=True,
        env=_docker_env(),
    )
    return output.strip()


def docker_logs(container_id: str) -> str:
    output = subprocess.check_output(
        ["docker", "logs", container_id],
        cwd=str(REPO_ROOT),
        stderr=subprocess.STDOUT,
        text=True,
        env=_docker_env(),
    )
    return output


def docker_exec(container_id: str, *args: str) -> None:
    subprocess.check_call(
        ["docker", "exec", container_id, *args],
        cwd=str(REPO_ROOT),
        env=_docker_env(),
    )


def docker_exec_text(container_id: str, *args: str) -> str:
    output = subprocess.check_output(
        ["docker", "exec", container_id, *args],
        cwd=str(REPO_ROOT),
        text=True,
        env=_docker_env(),
    )
    return output


def parse_mem_to_mib(raw_value: str) -> float:
    token = str(raw_value or "").strip().split("/", 1)[0].strip()
    if not token:
        return 0.0
    number = ""
    unit = ""
    for char in token:
        if char.isdigit() or char in {".", ","}:
            number += "." if char == "," else char
        else:
            unit += char
    amount = float(number or "0")
    normalized_unit = unit.strip().lower()
    multipliers = {
        "b": 1 / (1024 * 1024),
        "kib": 1 / 1024,
        "kb": 1 / 1000,
        "mib": 1.0,
        "mb": 1000 * 1000 / (1024 * 1024),
        "gib": 1024.0,
        "gb": 1000 * 1000 * 1000 / (1024 * 1024),
    }
    return round(amount * multipliers.get(normalized_unit, 1.0), 3)


def docker_mem_usage(container_id: str) -> float:
    output = subprocess.check_output(
        [
            "docker",
            "stats",
            "--no-stream",
            "--format",
            "{{.MemUsage}}",
            container_id,
        ],
        cwd=str(REPO_ROOT),
        text=True,
        env=_docker_env(),
    )
    return parse_mem_to_mib(output.strip())
