from __future__ import annotations

import importlib
import os
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parents[3]
API_ROOT = REPO_ROOT / "apps" / "api"
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

MODULE_STATE_DIR = Path("/tmp/infinito-deployer-test-audit-api")
MODULE_STATE_DIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("STATE_DIR", str(MODULE_STATE_DIR))


def _workspace_logs_module():
    import api.routes.workspace_logs as workspace_logs_module

    return workspace_logs_module


class _FakeAuditLogService:
    def __init__(self) -> None:
        self.build_calls: list[dict[str, object]] = []
        self.enqueued: list[dict[str, object]] = []

    def build_event(self, *, request, status: int, duration_ms: int):
        event = {
            "path": request.url.path,
            "status": status,
            "duration_ms": duration_ms,
        }
        self.build_calls.append(event)
        return event

    def enqueue_event(self, event: dict[str, object]) -> None:
        self.enqueued.append(event)


class _FakeWorkspaceService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str | None]] = []
        self.rejected: set[str] = set()

    def assert_workspace_access(self, workspace_id: str, user_id: str | None):
        self.calls.append((workspace_id, user_id))
        if workspace_id in self.rejected:
            raise HTTPException(status_code=404, detail="workspace not found")
        return {"workspace_id": workspace_id, "owner_id": user_id}


class _FakeWorkspaceLogService:
    def __init__(self) -> None:
        self.config = {
            "workspace_id": "ws-1",
            "retention_days": 180,
            "mode": "all",
            "exclude_health_endpoints": False,
        }
        self.list_calls: list[dict[str, object]] = []
        self.export_calls: list[dict[str, object]] = []
        self.update_calls: list[dict[str, object]] = []

    @staticmethod
    def _config_obj(data: dict[str, object]):
        class _Config:
            def __init__(self, payload: dict[str, object]) -> None:
                self._payload = dict(payload)

            def as_dict(self):
                return dict(self._payload)

        return _Config(data)

    def get_config(self, workspace_id: str):
        return self._config_obj(self.config)

    def update_config(
        self,
        workspace_id: str,
        *,
        retention_days: int,
        mode: str,
        exclude_health_endpoints: bool,
    ):
        self.config = {
            "workspace_id": workspace_id,
            "retention_days": retention_days,
            "mode": mode,
            "exclude_health_endpoints": exclude_health_endpoints,
        }
        self.update_calls.append(dict(self.config))
        return self._config_obj(self.config)

    def list_entries(self, workspace_id: str, **kwargs):
        self.list_calls.append({"workspace_id": workspace_id, **kwargs})
        return {
            "entries": [
                {
                    "id": 1,
                    "timestamp": "2026-04-21T10:15:00Z",
                    "workspace_id": workspace_id,
                    "user": "anonymous",
                    "method": "GET",
                    "path": "/api/workspaces/ws-1/logs/config",
                    "status": 200,
                    "duration_ms": 12,
                    "ip": "127.0.0.1",
                    "request_id": "req-1",
                    "user_agent": "pytest",
                }
            ],
            "page": kwargs["page"],
            "page_size": kwargs["page_size"],
            "total": 1,
        }

    def export_entries(self, workspace_id: str, **kwargs):
        self.export_calls.append({"workspace_id": workspace_id, **kwargs})
        return {
            "body": b'{"timestamp":"2026-04-21T10:15:00Z"}\n',
            "filename": f"audit-log-{workspace_id}.jsonl",
            "media_type": "application/x-ndjson",
        }

    def stream_export_entries(self, workspace_id: str, **kwargs):
        result = self.export_entries(workspace_id, **kwargs)
        return {
            **result,
            "body": iter([result["body"]]),
        }


class TestAuditMiddleware(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._old_state_dir = os.environ.get("STATE_DIR")
        os.environ["STATE_DIR"] = self._tmp.name

    def tearDown(self) -> None:
        if self._old_state_dir is None:
            os.environ.pop("STATE_DIR", None)
        else:
            os.environ["STATE_DIR"] = self._old_state_dir

    def _build_app_with_fake_audit(self) -> tuple[TestClient, _FakeAuditLogService]:
        fake_audit = _FakeAuditLogService()
        main_module = importlib.import_module("main")

        with patch.object(main_module, "AuditLogService", return_value=fake_audit):
            app = main_module.create_app()

        @app.get("/_audit-test")
        def _audit_test():
            return {"ok": True}

        @app.get("/_audit-stream")
        def _audit_stream():
            def emit():
                yield "data: first\n\n"
                yield "data: second\n\n"

            return StreamingResponse(emit(), media_type="text/event-stream")

        return TestClient(app), fake_audit

    def test_middleware_enqueues_one_event_for_standard_request(self) -> None:
        client, fake_audit = self._build_app_with_fake_audit()

        response = client.get("/_audit-test")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(fake_audit.build_calls), 1)
        self.assertEqual(len(fake_audit.enqueued), 1)
        self.assertEqual(fake_audit.enqueued[0]["path"], "/_audit-test")

    def test_middleware_enqueues_one_event_for_sse_request(self) -> None:
        client, fake_audit = self._build_app_with_fake_audit()

        response = client.get("/_audit-stream")

        self.assertEqual(response.status_code, 200)
        self.assertIn("data: first", response.text)
        self.assertEqual(len(fake_audit.build_calls), 1)
        self.assertEqual(len(fake_audit.enqueued), 1)
        self.assertEqual(fake_audit.enqueued[0]["path"], "/_audit-stream")


class TestWorkspaceLogRoutes(unittest.TestCase):
    def test_routes_forward_filters_and_return_export_payloads(self) -> None:
        workspace_logs_module = _workspace_logs_module()
        fake_logs = _FakeWorkspaceLogService()
        fake_workspaces = _FakeWorkspaceService()
        app = FastAPI()
        app.include_router(workspace_logs_module.router, prefix="/api")

        with (
            patch.object(workspace_logs_module, "_logs", return_value=fake_logs),
            patch.object(
                workspace_logs_module, "_workspaces", return_value=fake_workspaces
            ),
        ):
            client = TestClient(app)

            config_response = client.get("/api/workspaces/ws-1/logs/config")
            self.assertEqual(config_response.status_code, 200)
            self.assertEqual(config_response.json()["workspace_id"], "ws-1")

            update_response = client.put(
                "/api/workspaces/ws-1/logs/config",
                json={
                    "retention_days": 90,
                    "mode": "errors-only",
                    "exclude_health_endpoints": True,
                },
            )
            self.assertEqual(update_response.status_code, 200)
            self.assertEqual(update_response.json()["mode"], "errors-only")

            list_response = client.get(
                "/api/workspaces/ws-1/logs/entries",
                params={
                    "page": 2,
                    "page_size": 25,
                    "from": "2026-04-21T10:00:00Z",
                    "to": "2026-04-21T11:00:00Z",
                    "user": "alice",
                    "ip": "203.0.113.7",
                    "q": "deploy",
                    "status": 500,
                    "method": "post",
                },
            )
            self.assertEqual(list_response.status_code, 200)
            self.assertEqual(list_response.json()["total"], 1)

            export_response = client.get(
                "/api/workspaces/ws-1/logs/entries/export",
                params={
                    "format": "jsonl",
                    "zip": "false",
                    "from": "2026-04-21T10:00:00Z",
                    "to": "2026-04-21T11:00:00Z",
                    "user": "alice",
                    "ip": "203.0.113.7",
                    "q": "deploy",
                    "status": 500,
                    "method": "GET",
                },
            )
            self.assertEqual(export_response.status_code, 200)
            self.assertEqual(
                export_response.headers["content-disposition"],
                'attachment; filename="audit-log-ws-1.jsonl"',
            )
            self.assertIn("2026-04-21T10:15:00Z", export_response.text)

        self.assertEqual(fake_workspaces.calls[0], ("ws-1", None))
        self.assertEqual(fake_logs.update_calls[0]["retention_days"], 90)
        self.assertEqual(fake_logs.list_calls[0]["workspace_id"], "ws-1")
        self.assertEqual(fake_logs.list_calls[0]["page"], 2)
        self.assertEqual(fake_logs.list_calls[0]["page_size"], 25)
        self.assertEqual(fake_logs.list_calls[0]["status"], 500)
        self.assertEqual(fake_logs.list_calls[0]["method"], "post")
        self.assertEqual(fake_logs.export_calls[0]["fmt"], "jsonl")
        self.assertEqual(fake_logs.export_calls[0]["method"], "GET")
        self.assertEqual(fake_logs.export_calls[0]["user"], "alice")
        self.assertEqual(fake_logs.export_calls[0]["ip"], "203.0.113.7")
        self.assertEqual(fake_logs.export_calls[0]["q"], "deploy")
        self.assertEqual(fake_logs.export_calls[0]["status"], 500)
        self.assertIsNotNone(fake_logs.export_calls[0]["from_ts"])
        self.assertIsNotNone(fake_logs.export_calls[0]["to_ts"])

    def test_invalid_config_is_rejected_with_validation_error(self) -> None:
        workspace_logs_module = _workspace_logs_module()
        fake_logs = _FakeWorkspaceLogService()
        fake_workspaces = _FakeWorkspaceService()
        app = FastAPI()
        app.include_router(workspace_logs_module.router, prefix="/api")

        with (
            patch.object(workspace_logs_module, "_logs", return_value=fake_logs),
            patch.object(
                workspace_logs_module, "_workspaces", return_value=fake_workspaces
            ),
        ):
            client = TestClient(app)
            response = client.put(
                "/api/workspaces/ws-1/logs/config",
                json={
                    "retention_days": 0,
                    "mode": "not-a-mode",
                    "exclude_health_endpoints": True,
                },
            )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(fake_logs.update_calls, [])

    def test_routes_enforce_workspace_access(self) -> None:
        workspace_logs_module = _workspace_logs_module()
        fake_logs = _FakeWorkspaceLogService()
        fake_workspaces = _FakeWorkspaceService()
        fake_workspaces.rejected.add("ws-denied")
        app = FastAPI()
        app.include_router(workspace_logs_module.router, prefix="/api")

        with (
            patch.object(workspace_logs_module, "_logs", return_value=fake_logs),
            patch.object(
                workspace_logs_module, "_workspaces", return_value=fake_workspaces
            ),
        ):
            client = TestClient(app)
            response = client.get("/api/workspaces/ws-denied/logs/entries")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(fake_logs.list_calls, [])

    def test_routes_forward_authenticated_user_to_workspace_access_checks(self) -> None:
        workspace_logs_module = _workspace_logs_module()
        fake_logs = _FakeWorkspaceLogService()
        fake_workspaces = _FakeWorkspaceService()
        app = FastAPI()
        app.include_router(workspace_logs_module.router, prefix="/api")

        with (
            patch.object(workspace_logs_module, "_logs", return_value=fake_logs),
            patch.object(
                workspace_logs_module, "_workspaces", return_value=fake_workspaces
            ),
            patch.dict(
                os.environ,
                {
                    "AUTH_PROXY_ENABLED": "true",
                    "AUTH_PROXY_USER_HEADER": "X-Auth-Request-User",
                },
                clear=False,
            ),
        ):
            client = TestClient(app)
            response = client.get(
                "/api/workspaces/ws-1/logs/config",
                headers={"X-Auth-Request-User": "alice"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(fake_workspaces.calls, [("ws-1", "alice")])


if __name__ == "__main__":
    unittest.main()
