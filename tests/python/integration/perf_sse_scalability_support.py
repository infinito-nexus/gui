from __future__ import annotations

import asyncio
import re
import time
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
POST_MEMORY_RATIO_LIMIT = 1.2
POST_MEMORY_ABSOLUTE_HEADROOM_MIB = 16.0
LINE_SEQ_PATTERN = re.compile(r"PERF-LINE seq=(\d+)")
RX_PATTERN = re.compile(r"^\[RX:(\d{10,})\]\s?(.*)$")
PERF_MASK_USER = "perfmask"
PERF_MASK_PASSWORD = "PerfMaskSecret-9a8b7c6d5e4f3g2h"


def post_memory_ceiling_mib(baseline_max_mib: float) -> float:
    return max(
        baseline_max_mib * POST_MEMORY_RATIO_LIMIT,
        baseline_max_mib + POST_MEMORY_ABSOLUTE_HEADROOM_MIB,
    )


class PerfSseScalabilityScenarioMixin:
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

            viewer_tasks = [
                asyncio.create_task(
                    self._watch_viewer(
                        client,
                        job_id,
                        name=f"viewer-{idx + 1}",
                        attach_at_ms=int(time.time() * 1000),
                    )
                )
                for idx in range(VIEWER_COUNT)
            ]

            role_poll_task = asyncio.create_task(
                self._poll_role_index_under_load(client)
            )
            await asyncio.sleep(LATE_VIEWER_DELAY_SECONDS)
            late_viewer_task = asyncio.create_task(
                self._watch_viewer(
                    client,
                    job_id,
                    name="viewer-late",
                    attach_at_ms=int(time.time() * 1000),
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

        samples = [
            *baseline_samples,
            *post_samples,
            *role_poll_samples,
        ]
        all_delay_values: list[float] = []
        failure_messages: list[str] = []

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
        post_memory_ceiling = post_memory_ceiling_mib(baseline_max)

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
            "post_memory_ceiling_mib": {
                "target": round(post_memory_ceiling, 3),
                "observed": post_max,
                "context": {
                    "baseline_max_mib": round(baseline_max, 3),
                    "ratio_limit": POST_MEMORY_RATIO_LIMIT,
                    "absolute_headroom_mib": POST_MEMORY_ABSOLUTE_HEADROOM_MIB,
                    "post_sample_count": len(post_samples),
                },
                "status": "pass" if post_max <= post_memory_ceiling else "fail",
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
