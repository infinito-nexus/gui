from __future__ import annotations

import asyncio
import json
import os
import time
from functools import lru_cache

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from api.auth import ensure_workspace_access
from api.schemas.deployment import DeploymentRequest
from api.schemas.deployment_job import (
    DeploymentCancelOut,
    DeploymentCreateOut,
    DeploymentJobOut,
)
from services.job_runner import JobRunnerService
from services.job_runner.log_hub import _release_process_memory
from services.job_runner.paths import job_paths
from services.job_runner.persistence import load_json
from services.job_runner.secrets import mask_secrets
from services.rate_limits import RateLimitService
from services.role_index.service import RoleIndexService
from services.job_runner.util import utc_iso
from services.workspaces import WorkspaceService

router = APIRouter(prefix="/deployments", tags=["deployments"])
_TERMINAL_STATUSES = {"succeeded", "failed", "canceled"}
_SSE_STATUS_PADDING = " " * 2048


@lru_cache(maxsize=1)
def _jobs() -> JobRunnerService:
    """
    Lazy singleton to avoid side effects on import time (e.g. filesystem writes).
    """
    return JobRunnerService()


@lru_cache(maxsize=1)
def _workspaces() -> WorkspaceService:
    return WorkspaceService()


@lru_cache(maxsize=1)
def _roles() -> RoleIndexService:
    return RoleIndexService()


def _require_known_roles(role_ids: list[str]) -> None:
    for role_id in role_ids or []:
        _roles().get(role_id)


def _resolve_job_workspace_id(job_id: str) -> str | None:
    request_payload = load_json(job_paths(job_id).request_path)
    workspace_id = str(request_payload.get("workspace_id") or "").strip()
    return workspace_id or None


def _require_job_workspace(request: Request, job_id: str) -> str | None:
    workspace_id = _resolve_job_workspace_id(job_id)
    if workspace_id:
        ensure_workspace_access(request, workspace_id, _workspaces())
    return workspace_id


def _rate_limits(request: Request) -> RateLimitService:
    return getattr(request.app.state, "rate_limits", None) or RateLimitService()


@router.post("", response_model=DeploymentCreateOut)
def create_deployment(req: DeploymentRequest, request: Request) -> DeploymentCreateOut:
    """
    Create a deployment job and start the runner subprocess.

    Security:
      - Secrets (password/private_key) are never persisted.
      - Inventory is copied from the workspace.
    """
    ensure_workspace_access(request, req.workspace_id, _workspaces())
    _rate_limits(request).enforce_deployment(request, req.workspace_id)
    _require_known_roles(list(req.selected_roles or []))
    job = _jobs().create(req)
    _workspaces().set_workspace_state(req.workspace_id, "deployed")
    return DeploymentCreateOut(job_id=job.job_id)


@router.get("/{job_id}", response_model=DeploymentJobOut)
def get_deployment(job_id: str, request: Request) -> DeploymentJobOut:
    _require_job_workspace(request, job_id)
    return _jobs().get(job_id)


@router.post("/{job_id}/cancel", response_model=DeploymentCancelOut)
def cancel_deployment(job_id: str, request: Request) -> DeploymentCancelOut:
    _require_job_workspace(request, job_id)
    ok = _jobs().cancel(job_id)
    return DeploymentCancelOut(ok=ok)


def _sse_event(event: str, data: str) -> str:
    lines = data.splitlines() if data else [""]
    payload = [f"event: {event}"]
    payload.extend(f"data: {line}" for line in lines)
    return "\n".join(payload) + "\n\n"


def _split_log_lines(buffer: str) -> tuple[list[str], str]:
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

        line = buffer[:idx]
        buffer = buffer[idx + 1 :]
        lines.append(line)

    return lines, buffer


@router.get("/{job_id}/logs")
async def stream_logs(
    job_id: str,
    request: Request,
    replay: bool = Query(default=True),
) -> StreamingResponse:
    """
    Stream deployment logs via Server-Sent Events (SSE).

    Events:
      - log:    individual log lines
      - status: job status changes
      - done:   terminal status + exit code
    """
    _require_job_workspace(request, job_id)
    _jobs().get(job_id)  # validate job exists
    paths = job_paths(job_id)
    secrets = _jobs().get_secrets(job_id)
    attached_at_unix_ms = int(time.time() * 1000)
    queue, buffered_lines = _jobs().subscribe_logs(job_id, replay_buffer=replay)

    async def event_stream():
        last_status = None
        buffer = ""
        received_hub_data = bool(buffered_lines)
        log_fh = None
        terminal_since: float | None = None
        last_heartbeat = time.monotonic()
        event_seq = 0

        def next_payload(event_type: str, **payload: object) -> str:
            nonlocal event_seq
            event_seq += 1
            envelope = {
                "type": event_type,
                "job_id": job_id,
                "seq": event_seq,
                "timestamp": utc_iso(),
                **payload,
            }
            return json.dumps(envelope, ensure_ascii=False)

        meta = load_json(paths.meta_path)
        status = meta.get("status") or "queued"
        last_status = status
        # Give the browser a brief moment to install its EventSource listeners
        # before we emit the initial buffered status/log frames.
        await asyncio.sleep(0.1)
        yield _sse_event(
            "status",
            next_payload(
                "status",
                status=status,
                started_at=meta.get("started_at"),
                finished_at=meta.get("finished_at"),
                exit_code=meta.get("exit_code"),
                attached_at_unix_ms=attached_at_unix_ms,
                _stream_padding=_SSE_STATUS_PADDING,
            ),
        )

        try:
            for line in buffered_lines:
                yield _sse_event(
                    "log",
                    next_payload("log", line=mask_secrets(line, secrets)),
                )

            while True:
                if await request.is_disconnected():
                    break

                new_data = False
                while True:
                    try:
                        line = queue.get_nowait()
                    except Exception:
                        break
                    new_data = True
                    received_hub_data = True
                    yield _sse_event(
                        "log",
                        next_payload("log", line=mask_secrets(line, secrets)),
                    )

                if (
                    not received_hub_data
                    and not new_data
                    and log_fh is None
                    and paths.log_path.exists()
                ):
                    # Fallback for jobs whose live logs are written directly to
                    # job.log (for example runner-manager executed jobs).
                    log_fh = open(
                        paths.log_path,
                        "rb",
                        buffering=0,  # noqa: SIM115
                    )
                    if not replay:
                        log_fh.seek(0, os.SEEK_END)

                if log_fh is not None:
                    chunk = log_fh.read()
                    if chunk:
                        new_data = True
                        buffer += chunk.decode("utf-8", errors="replace")
                        lines, buffer = _split_log_lines(buffer)
                        for line in lines:
                            yield _sse_event(
                                "log",
                                next_payload("log", line=mask_secrets(line, secrets)),
                            )

                meta = load_json(paths.meta_path)
                status = meta.get("status") or "queued"
                if status != last_status:
                    last_status = status
                    yield _sse_event(
                        "status",
                        next_payload(
                            "status",
                            status=status,
                            started_at=meta.get("started_at"),
                            finished_at=meta.get("finished_at"),
                            exit_code=meta.get("exit_code"),
                        ),
                    )

                if status in _TERMINAL_STATUSES:
                    if terminal_since is None:
                        terminal_since = time.monotonic()

                    if not new_data and (time.monotonic() - terminal_since) >= 0.5:
                        if buffer:
                            yield _sse_event(
                                "log",
                                next_payload("log", line=mask_secrets(buffer, secrets)),
                            )
                            buffer = ""
                        yield _sse_event(
                            "done",
                            next_payload(
                                "done",
                                status=status,
                                finished_at=meta.get("finished_at"),
                                exit_code=meta.get("exit_code"),
                            ),
                        )
                        break
                else:
                    terminal_since = None

                if time.monotonic() - last_heartbeat >= 10:
                    last_heartbeat = time.monotonic()
                    yield _sse_event(
                        "status",
                        next_payload(
                            "status",
                            status=status,
                            started_at=meta.get("started_at"),
                            finished_at=meta.get("finished_at"),
                            exit_code=meta.get("exit_code"),
                            heartbeat=True,
                        ),
                    )

                await asyncio.sleep(0.2)
        finally:
            if log_fh is not None:
                try:
                    log_fh.close()
                except Exception:
                    pass
            _jobs().unsubscribe_logs(job_id, queue)
            _release_process_memory()

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers=headers,
    )
