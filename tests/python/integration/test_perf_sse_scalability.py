from __future__ import annotations

import asyncio
import json
import re
import time
import unittest
from pathlib import Path
from typing import Any

import httpx

from .perf_support import (
    REPO_ROOT,
    api_base_url,
    compose_ps_quiet,
    docker_exec_text,
    docker_inspect_started_at,
    docker_logs,
    docker_mem_usage,
    timing_summary,
    wait_for_http_ready,
    write_perf_result,
)


ROLE_LIST_P95_TARGET_MS = 200.0
MAX_LINE_DELAY_MS = 30_000.0
MIN_EXPECTED_EMIT_LINES = 120
BASELINE_SECONDS = 30
POST_SECONDS = 60
VIEWER_COUNT = 10
STREAM_TIMEOUT_SECONDS = 120
LATE_VIEWER_DELAY_SECONDS = 30
ROLE_LOAD_BURST_SIZE = 5
LINE_SEQ_PATTERN = re.compile(r"PERF-LINE seq=(\d+)")
RX_PATTERN = re.compile(r"^\[RX:(\d{10,})\]\s?(.*)$")
PERF_MASK_USER = "perfmask"
PERF_MASK_PASSWORD = "PerfMaskSecret-9a8b7c6d5e4f3g2h"


class TestPerfSseScalability(unittest.TestCase):
    def test_sse_scalability(self) -> None:
        result = asyncio.run(self._run_scenario())
        self.assertEqual(result["status"], "pass", result["failure_message"])

    async def _run_scenario(self) -> dict[str, Any]:
        base_url = api_base_url()
        wait_for_http_ready(f"{base_url}/health")

        api_container_id = compose_ps_quiet("api")
        self.assertTrue(api_container_id, "api container must be running for perf test")
        api_started_before = docker_inspect_started_at(api_container_id)

        async with httpx.AsyncClient(base_url=base_url, timeout=30.0) as client:
            await self._warm_role_index(client)
            baseline_samples = self._sample_memory(
                api_container_id, seconds=BASELINE_SECONDS
            )
            workspace_id = await self._create_workspace(client)
            await self._upload_playbook_fixture(client, workspace_id)
            await self._generate_inventory(client, workspace_id)
            job_id = await self._create_fixture_deployment(client, workspace_id)

            viewer_tasks = []
            for idx in range(VIEWER_COUNT):
                viewer_tasks.append(
                    asyncio.create_task(
                        self._watch_viewer(
                            client,
                            job_id,
                            name=f"viewer-{idx + 1}",
                            attach_at_ms=int(time.time() * 1000),
                        )
                    )
                )

            role_poll_task = asyncio.create_task(
                self._poll_role_index_under_load(client)
            )
            await asyncio.sleep(LATE_VIEWER_DELAY_SECONDS)
            late_attach_at_ms = int(time.time() * 1000)
            late_viewer_task = asyncio.create_task(
                self._watch_viewer(
                    client,
                    job_id,
                    name="viewer-late",
                    attach_at_ms=late_attach_at_ms,
                )
            )

            viewer_results = await asyncio.gather(*viewer_tasks, late_viewer_task)
            role_poll_samples = await role_poll_task

        post_samples = self._sample_memory(api_container_id, seconds=POST_SECONDS)
        api_started_after = docker_inspect_started_at(api_container_id)
        api_log_text = docker_logs(api_container_id)
        persisted_job_log = docker_exec_text(
            api_container_id,
            "sh",
            "-lc",
            f'cat "${{STATE_DIR}}/jobs/{job_id}/job.log"',
        )
        emitted_line_count = len(LINE_SEQ_PATTERN.findall(persisted_job_log))

        samples: list[dict[str, Any]] = []
        all_delay_values: list[float] = []
        failure_messages: list[str] = []

        for sample in baseline_samples:
            samples.append(sample)
        for sample in post_samples:
            samples.append(sample)
        for sample in role_poll_samples:
            samples.append(sample)

        for viewer_result in viewer_results:
            samples.extend(viewer_result["samples"])
            all_delay_values.extend(viewer_result["delay_values"])
            if viewer_result["failure"]:
                failure_messages.append(viewer_result["failure"])
            if int(viewer_result["perf_line_count"]) <= 0:
                failure_messages.append(
                    f"{viewer_result['name']} did not observe any PERF-LINE events"
                )

        if not all_delay_values:
            failure_messages.append(
                "no PERF-LINE samples were observed across the SSE viewers"
            )
        if emitted_line_count < MIN_EXPECTED_EMIT_LINES:
            failure_messages.append(
                f"fixture deployment emitted only {emitted_line_count} PERF-LINE messages in job.log"
            )

        role_poll_values = [float(sample["value_ms"]) for sample in role_poll_samples]
        role_poll_summary = timing_summary(role_poll_values)
        delay_summary = timing_summary(all_delay_values)
        baseline_max = max(float(sample["value_mib"]) for sample in baseline_samples)
        post_max = max(float(sample["value_mib"]) for sample in post_samples)

        if api_started_before != api_started_after:
            failure_messages.append(
                "api container restarted during the SSE scalability scenario"
            )
        if (
            "Traceback" in api_log_text
            or "Exception in ASGI application" in api_log_text
        ):
            failure_messages.append(
                "api logs contained an unhandled exception during scalability run"
            )
        if PERF_MASK_PASSWORD in persisted_job_log:
            failure_messages.append("persisted job.log leaked the perf masking secret")

        thresholds = {
            "roles_under_load_p95": {
                "target": ROLE_LIST_P95_TARGET_MS,
                "observed": role_poll_summary["p95"],
                "context": {
                    "endpoint": "/api/roles",
                    "sample_count": len(role_poll_values),
                },
                "status": "pass"
                if float(role_poll_summary["p95"]) < ROLE_LIST_P95_TARGET_MS
                else "fail",
            },
            "max_line_delay_ms": {
                "target": MAX_LINE_DELAY_MS,
                "observed": delay_summary["max"],
                "context": {
                    "viewer_count": len(viewer_results),
                    "sample_count": len(all_delay_values),
                },
                "status": "pass"
                if float(delay_summary["max"]) <= MAX_LINE_DELAY_MS
                else "fail",
            },
            "post_memory_ratio": {
                "target": round(baseline_max * 1.2, 3),
                "observed": post_max,
                "context": {
                    "baseline_max_mib": round(baseline_max, 3),
                    "post_sample_count": len(post_samples),
                },
                "status": "pass" if post_max <= baseline_max * 1.2 else "fail",
            },
        }

        for threshold_name, threshold in thresholds.items():
            if str(threshold["status"]) == "fail":
                failure_messages.append(
                    f"{threshold_name} violated: observed={threshold['observed']} target={threshold['target']} context={threshold.get('context')}"
                )

        status = "pass" if not failure_messages else "fail"
        write_perf_result(
            "sse-scalability",
            samples=samples,
            thresholds=thresholds,
            summary_values=all_delay_values or [0.0],
            status=status,
            failure_messages=failure_messages,
        )
        self._assert_secret_absent(
            REPO_ROOT / "state" / "perf" / "016" / "sse-scalability.json"
        )
        return {
            "status": status,
            "failure_message": "; ".join(failure_messages) or "SSE scalability failed",
        }

    async def _warm_role_index(self, client: httpx.AsyncClient) -> None:
        for _ in range(5):
            response = await client.get("/api/roles")
            response.raise_for_status()

    async def _prime_csrf(self, client: httpx.AsyncClient) -> dict[str, str]:
        response = await client.get("/health")
        response.raise_for_status()
        token = str(client.cookies.get("csrf") or "").strip()
        self.assertTrue(token, "anonymous perf client must receive a csrf cookie")
        return {"X-CSRF": token, "Cookie": f"csrf={token}"}

    async def _create_workspace(self, client: httpx.AsyncClient) -> str:
        csrf_headers = await self._prime_csrf(client)
        response = await client.post(
            "/api/workspaces",
            headers=csrf_headers,
        )
        response.raise_for_status()
        workspace_id = str(response.json().get("workspace_id") or "").strip()
        self.assertTrue(workspace_id, "workspace creation must return an id")
        return workspace_id

    async def _upload_playbook_fixture(
        self, client: httpx.AsyncClient, workspace_id: str
    ) -> None:
        playbook_text = (
            REPO_ROOT / "tests" / "fixtures" / "perf" / "emit_lines.yml"
        ).read_text(encoding="utf-8")
        csrf_headers = await self._prime_csrf(client)
        response = await client.put(
            f"/api/workspaces/{workspace_id}/files/playbooks/emit_lines.yml",
            json={"content": playbook_text},
            headers=csrf_headers,
        )
        response.raise_for_status()

    async def _generate_inventory(
        self, client: httpx.AsyncClient, workspace_id: str
    ) -> None:
        csrf_headers = await self._prime_csrf(client)
        response = await client.post(
            f"/api/workspaces/{workspace_id}/generate-inventory",
            json={
                "alias": "target",
                "host": "ssh-password",
                "port": 22,
                "user": PERF_MASK_USER,
                "auth_method": "password",
                "selected_roles": ["web-app-dashboard"],
            },
            headers=csrf_headers,
        )
        response.raise_for_status()

    async def _create_fixture_deployment(
        self, client: httpx.AsyncClient, workspace_id: str
    ) -> str:
        csrf_headers = await self._prime_csrf(client)
        response = await client.post(
            "/api/deployments",
            json={
                "workspace_id": workspace_id,
                "host": "ssh-password",
                "port": 22,
                "user": PERF_MASK_USER,
                "auth": {"method": "password", "password": PERF_MASK_PASSWORD},
                "selected_roles": [],
                "playbook_path": "playbooks/emit_lines.yml",
                "limit": "target",
            },
            headers=csrf_headers,
        )
        response.raise_for_status()
        job_id = str(response.json().get("job_id") or "").strip()
        self.assertTrue(job_id, "deployment creation must return job_id")
        return job_id

    async def _poll_role_index_under_load(
        self, client: httpx.AsyncClient
    ) -> list[dict[str, Any]]:
        samples: list[dict[str, Any]] = []
        deadline = time.monotonic() + STREAM_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            for _ in range(ROLE_LOAD_BURST_SIZE):
                started_at = time.perf_counter()
                response = await client.get("/api/roles")
                elapsed_ms = (time.perf_counter() - started_at) * 1000
                response.raise_for_status()
                samples.append(
                    {
                        "name": "GET /api/roles under load",
                        "value_ms": round(elapsed_ms, 3),
                        "timestamp": time.time(),
                    }
                )
            await asyncio.sleep(5)
            if len(samples) >= 12 * ROLE_LOAD_BURST_SIZE:
                break
        return samples

    async def _watch_viewer(
        self,
        client: httpx.AsyncClient,
        job_id: str,
        *,
        name: str,
        attach_at_ms: int,
    ) -> dict[str, Any]:
        samples: list[dict[str, Any]] = []
        delay_values: list[float] = []
        failure: str | None = None
        last_seq = -1
        saw_done = False
        viewer_state = {"perf_line_count": 0}

        try:
            async with asyncio.timeout(STREAM_TIMEOUT_SECONDS):
                async with client.stream(
                    "GET",
                    f"/api/deployments/{job_id}/logs",
                    params={"replay": "false"},
                    headers={"Accept": "text/event-stream"},
                    timeout=None,
                ) as response:
                    response.raise_for_status()
                    attach_state = {"value": 0}
                    frame_index = 0
                    buffer = ""
                    pending_cr = ""
                    async for chunk in response.aiter_text():
                        text = pending_cr + chunk
                        pending_cr = ""
                        if text.endswith("\r"):
                            pending_cr = "\r"
                            text = text[:-1]
                        text = text.replace("\r\n", "\n").replace("\r", "\n")
                        buffer += text

                        while "\n\n" in buffer:
                            raw_frame, buffer = buffer.split("\n\n", 1)
                            if not raw_frame:
                                continue
                            frame_index += 1
                            event_name = "message"
                            data_lines: list[str] = []
                            for line in raw_frame.split("\n"):
                                if line.startswith(":"):
                                    failure = f"{name} received unsupported SSE comment line: {line!r}"
                                    break
                                field, separator, raw_value = line.partition(":")
                                if not separator or field not in {
                                    "event",
                                    "data",
                                    "id",
                                    "retry",
                                }:
                                    failure = f"{name} received invalid SSE line in frame {frame_index}: {line!r}"
                                    break
                                value = (
                                    raw_value[1:]
                                    if raw_value.startswith(" ")
                                    else raw_value
                                )
                                if field == "event":
                                    event_name = value or "message"
                                elif field == "data":
                                    data_lines.append(value)
                            if failure:
                                break
                            if not data_lines:
                                failure = f"{name} received frame {frame_index} without any data lines"
                                break
                            event_name, last_seq, saw_done, failure = (
                                self._handle_sse_event(
                                    event_name=event_name,
                                    data="\n".join(data_lines),
                                    viewer_name=name,
                                    attach_state=attach_state,
                                    last_seq=last_seq,
                                    samples=samples,
                                    delay_values=delay_values,
                                    viewer_state=viewer_state,
                                )
                            )
                            if failure or saw_done:
                                break
                        if failure or saw_done:
                            break
                    if not failure:
                        trailing = (
                            (pending_cr + buffer)
                            .replace("\r\n", "\n")
                            .replace("\r", "\n")
                        )
                        if trailing.strip():
                            failure = (
                                f"{name} stream ended with an unterminated SSE frame"
                            )
        except TimeoutError:
            failure = f"{name} timed out before receiving terminal done event"
        except Exception as exc:  # pragma: no cover - integration-only behaviour
            failure = f"{name} stream failed: {exc}"

        if not failure and not saw_done:
            failure = f"{name} stream closed before terminal done event"

        return {
            "samples": samples,
            "delay_values": delay_values,
            "failure": failure,
            "name": name,
            "perf_line_count": viewer_state["perf_line_count"],
        }

    def _handle_sse_event(
        self,
        *,
        event_name: str,
        data: str,
        viewer_name: str,
        attach_state: dict[str, int],
        last_seq: int,
        samples: list[dict[str, Any]],
        delay_values: list[float],
        viewer_state: dict[str, int],
    ) -> tuple[str, int, bool, str | None]:
        payload = json.loads(data)
        if str(payload.get("type") or "") not in {"log", "status", "done"}:
            return (
                event_name,
                last_seq,
                False,
                f"{viewer_name} received invalid payload type",
            )

        seq = int(payload.get("seq") or 0)
        if seq < last_seq:
            return (
                event_name,
                last_seq,
                False,
                f"{viewer_name} received decreasing seq values",
            )
        last_seq = seq

        if event_name == "error":
            return event_name, last_seq, False, f"{viewer_name} received event:error"

        if payload["type"] == "log":
            line = str(payload.get("line") or "")
            if PERF_MASK_PASSWORD in line:
                return (
                    event_name,
                    last_seq,
                    False,
                    f"{viewer_name} received leaked perf masking secret",
                )
            match = RX_PATTERN.match(line)
            if not match:
                return (
                    event_name,
                    last_seq,
                    False,
                    f"{viewer_name} received log line without [RX:<unix_ms>] prefix",
                )
            rx_unix_ms = int(match.group(1))
            if rx_unix_ms < attach_state["value"]:
                return (
                    event_name,
                    last_seq,
                    False,
                    f"{viewer_name} received replay older than its attachment time",
                )
            rendered_at_ms = int(time.time() * 1000)
            delay_ms = float(max(0, rendered_at_ms - rx_unix_ms))
            delay_values.append(delay_ms)
            samples.append(
                {
                    "name": f"{viewer_name} log delay",
                    "value_ms": round(delay_ms, 3),
                    "timestamp": time.time(),
                }
            )
            if delay_ms > MAX_LINE_DELAY_MS:
                return (
                    event_name,
                    last_seq,
                    False,
                    f"{viewer_name} exceeded the 30s line delay bound",
                )
            line_seq_match = LINE_SEQ_PATTERN.search(match.group(2))
            if not line_seq_match:
                return event_name, last_seq, False, None
            viewer_state["perf_line_count"] += 1
            return event_name, last_seq, False, None

        if payload["type"] == "done":
            if str(payload.get("status") or "") != "succeeded":
                return (
                    event_name,
                    last_seq,
                    True,
                    f"{viewer_name} saw terminal deployment status {payload.get('status')!r}",
                )
            if int(payload.get("exit_code") or 0) != 0:
                return (
                    event_name,
                    last_seq,
                    True,
                    f"{viewer_name} saw non-zero deployment exit code {payload.get('exit_code')!r}",
                )
            return event_name, last_seq, True, None

        if payload["type"] == "status":
            attached_value = payload.get("attached_at_unix_ms")
            if isinstance(attached_value, int):
                attach_state["value"] = max(attach_state["value"], attached_value)
        return event_name, last_seq, False, None

    def _sample_memory(
        self, api_container_id: str, *, seconds: int
    ) -> list[dict[str, Any]]:
        samples: list[dict[str, Any]] = []
        for _ in range(seconds):
            mem_value = docker_mem_usage(api_container_id)
            samples.append(
                {
                    "name": "api memory",
                    "value_mib": round(mem_value, 3),
                    "timestamp": time.time(),
                }
            )
            time.sleep(1)
        return samples

    def _assert_secret_absent(self, path: Path) -> None:
        text = path.read_text(encoding="utf-8", errors="replace")
        self.assertNotIn(
            PERF_MASK_PASSWORD,
            text,
            f"perf output leaked secret in {path}",
        )
