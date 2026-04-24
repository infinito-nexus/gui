import asyncio
import importlib.util
import json
import queue
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch


def _load_deployments_module():
    repo_root = Path(__file__).resolve().parents[3]
    deployments_py = repo_root / "apps" / "api" / "api" / "routes" / "deployments.py"

    spec = importlib.util.spec_from_file_location(
        "deployments_sse_test", deployments_py
    )
    assert spec is not None
    assert spec.loader is not None

    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestSseHelpers(unittest.TestCase):
    def test_sse_event_format(self) -> None:
        mod = _load_deployments_module()
        payload = mod._sse_event("log", "hello\nworld")

        self.assertIn("event: log", payload)
        self.assertIn("data: hello", payload)
        self.assertIn("data: world", payload)
        self.assertTrue(payload.endswith("\n\n"))

    def test_split_log_lines_handles_cr_and_lf(self) -> None:
        mod = _load_deployments_module()
        lines, rest = mod._split_log_lines("one\rtwo\nthree")

        self.assertEqual(lines, ["one", "two"])
        self.assertEqual(rest, "three")

    def test_stream_logs_tails_job_log_without_replaying_history(self) -> None:
        mod = _load_deployments_module()

        class _FakeJobs:
            def __init__(self) -> None:
                self.unsubscribed = False

            def get(self, job_id: str) -> dict[str, str]:
                return {"job_id": job_id}

            def get_secrets(self, job_id: str) -> list[str]:
                return []

            def subscribe_logs(self, job_id: str, replay_buffer: bool = True):
                return queue.Queue(), []

            def unsubscribe_logs(self, job_id: str, q) -> None:
                self.unsubscribed = True

        class _FakeRequest:
            def __init__(self) -> None:
                self.state = SimpleNamespace()

            async def is_disconnected(self) -> bool:
                return False

        async def _exercise_stream() -> tuple[str, _FakeJobs]:
            fake_jobs = _FakeJobs()
            with TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                log_path = tmp_path / "job.log"
                meta_path = tmp_path / "job.json"
                log_path.write_text("[RX:100] old line\n", encoding="utf-8")
                meta_path.write_text(
                    json.dumps(
                        {
                            "status": "running",
                            "started_at": "2026-04-23T00:00:00Z",
                            "finished_at": None,
                            "exit_code": None,
                        }
                    ),
                    encoding="utf-8",
                )

                async def _append_new_line() -> None:
                    await asyncio.sleep(0.2)
                    with log_path.open("a", encoding="utf-8") as handle:
                        handle.write("[RX:200] fresh line\n")
                    meta_path.write_text(
                        json.dumps(
                            {
                                "status": "succeeded",
                                "started_at": "2026-04-23T00:00:00Z",
                                "finished_at": "2026-04-23T00:00:01Z",
                                "exit_code": 0,
                            }
                        ),
                        encoding="utf-8",
                    )

                with (
                    patch.object(mod, "_require_job_workspace", return_value=None),
                    patch.object(mod, "_jobs", return_value=fake_jobs),
                    patch.object(
                        mod,
                        "job_paths",
                        return_value=SimpleNamespace(
                            meta_path=meta_path, log_path=log_path
                        ),
                    ),
                    patch.object(mod, "_release_process_memory"),
                ):
                    response = await mod.stream_logs(
                        "job-1",
                        _FakeRequest(),
                        replay=False,
                    )
                    append_task = asyncio.create_task(_append_new_line())
                    chunks: list[str] = []
                    async for chunk in response.body_iterator:
                        chunks.append(
                            chunk.decode("utf-8")
                            if isinstance(chunk, bytes)
                            else str(chunk)
                        )
                    await append_task
                    return "".join(chunks), fake_jobs

        payload, fake_jobs = asyncio.run(_exercise_stream())

        self.assertIn("fresh line", payload)
        self.assertNotIn("old line", payload)
        self.assertIn("event: done", payload)
        self.assertTrue(fake_jobs.unsubscribed)
