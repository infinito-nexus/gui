from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import httpx

from .perf_sse_scalability_support import (
    LINE_SEQ_PATTERN,
    MAX_LINE_DELAY_MS,
    PERF_MASK_PASSWORD,
    RX_PATTERN,
    STREAM_TIMEOUT_SECONDS,
)


class PerfSseScalabilityStreamMixin:
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
                                    failure = (
                                        f"{name} received unsupported SSE comment line: {line!r}"
                                    )
                                    break
                                field, separator, raw_value = line.partition(":")
                                if not separator or field not in {
                                    "event",
                                    "data",
                                    "id",
                                    "retry",
                                }:
                                    failure = (
                                        f"{name} received invalid SSE line in frame {frame_index}: {line!r}"
                                    )
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
                                failure = (
                                    f"{name} received frame {frame_index} without any data lines"
                                )
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
            if LINE_SEQ_PATTERN.search(match.group(2)):
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
