from __future__ import annotations

import importlib
import inspect
import os
import unittest

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import ValidationError

from api.schemas.deployment import DeploymentRequest
from api.schemas.workspace import WorkspaceCredentialsIn, WorkspaceGenerateIn


class TestApiSecurityControls(unittest.TestCase):
    def setUp(self) -> None:
        self._saved_env = {
            key: os.environ.get(key)
            for key in (
                "ALLOWED_ORIGINS",
                "AUTH_PROXY_ENABLED",
                "CORS_ALLOW_ORIGINS",
                "INPUT_MAX_BODY_BYTES",
                "INPUT_MAX_NESTING",
                "STATE_DIR",
            )
        }
        os.environ["STATE_DIR"] = "/tmp/infinito-deployer-test-security-controls"

    def tearDown(self) -> None:
        for key, value in self._saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_create_app_rejects_wildcard_origins(self) -> None:
        main_module = importlib.import_module("main")
        os.environ["ALLOWED_ORIGINS"] = "*"
        os.environ["CORS_ALLOW_ORIGINS"] = ""

        with self.assertRaises(ValueError):
            main_module.create_app()

    def test_security_headers_are_added_to_responses(self) -> None:
        main_module = importlib.import_module("main")
        os.environ["ALLOWED_ORIGINS"] = "http://127.0.0.1:3000"
        os.environ["CORS_ALLOW_ORIGINS"] = ""
        app = main_module.create_app()
        client = TestClient(app)

        response = client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertEqual(response.headers["referrer-policy"], "same-origin")
        set_cookie = response.headers.get("set-cookie", "")
        self.assertIn("csrf=", set_cookie)
        self.assertIn("secure", set_cookie.lower())
        self.assertIn("samesite=strict", set_cookie.lower())
        self.assertNotIn("httponly", set_cookie.lower())

    def test_health_endpoint_payload_is_minimal(self) -> None:
        main_module = importlib.import_module("main")
        os.environ["ALLOWED_ORIGINS"] = "http://127.0.0.1:3000"
        os.environ["CORS_ALLOW_ORIGINS"] = ""
        app = main_module.create_app()
        client = TestClient(app)

        response = client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_cors_preflight_uses_explicit_origin_without_wildcard(self) -> None:
        main_module = importlib.import_module("main")
        os.environ["ALLOWED_ORIGINS"] = "http://127.0.0.1:3000"
        os.environ["CORS_ALLOW_ORIGINS"] = ""
        app = main_module.create_app()

        @app.post("/_preflight")
        def _preflight():
            return {"ok": True}

        client = TestClient(app)
        response = client.options(
            "/_preflight",
            headers={
                "Origin": "http://127.0.0.1:3000",
                "Access-Control-Request-Method": "POST",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers.get("access-control-allow-origin"),
            "http://127.0.0.1:3000",
        )
        self.assertEqual(
            response.headers.get("access-control-allow-credentials"),
            "true",
        )

    def test_secret_endpoints_use_no_referrer_policy(self) -> None:
        main_module = importlib.import_module("main")
        os.environ["ALLOWED_ORIGINS"] = "http://127.0.0.1:3000"
        os.environ["CORS_ALLOW_ORIGINS"] = ""
        app = main_module.create_app()

        @app.get("/api/workspaces/ws-1/credentials")
        def _credentials():
            return {"ok": True}

        client = TestClient(app)
        response = client.get("/api/workspaces/ws-1/credentials")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["referrer-policy"], "no-referrer")

    def test_anonymous_state_changes_require_matching_csrf_cookie_and_header(
        self,
    ) -> None:
        main_module = importlib.import_module("main")
        os.environ["ALLOWED_ORIGINS"] = "http://127.0.0.1:3000"
        os.environ["CORS_ALLOW_ORIGINS"] = ""
        os.environ["AUTH_PROXY_ENABLED"] = "false"
        app = main_module.create_app()

        @app.post("/_csrf-echo")
        def _csrf_echo(payload: dict):
            return payload

        client = TestClient(app)
        rejected = client.post("/_csrf-echo", json={"ok": True})
        self.assertEqual(rejected.status_code, 403)
        self.assertIn("CSRF token mismatch", rejected.text)

        priming = client.get("/health")
        csrf_cookie = priming.cookies.get("csrf")
        self.assertTrue(csrf_cookie)

        accepted = client.post(
            "/_csrf-echo",
            json={"ok": True},
            headers={
                "X-CSRF": csrf_cookie,
                "Cookie": f"csrf={csrf_cookie}",
            },
        )
        self.assertEqual(accepted.status_code, 200)

    def test_anonymous_state_changes_reject_sec_prefixed_csrf_headers(self) -> None:
        main_module = importlib.import_module("main")
        os.environ["ALLOWED_ORIGINS"] = "http://127.0.0.1:3000"
        os.environ["CORS_ALLOW_ORIGINS"] = ""
        os.environ["AUTH_PROXY_ENABLED"] = "false"
        app = main_module.create_app()

        @app.post("/_csrf-echo")
        def _csrf_echo(payload: dict):
            return payload

        client = TestClient(app)
        priming = client.get("/health")
        csrf_cookie = priming.cookies.get("csrf")
        self.assertTrue(csrf_cookie)

        rejected = client.post(
            "/_csrf-echo",
            json={"ok": True},
            headers={
                "Sec-CSRF": csrf_cookie,
                "Cookie": f"csrf={csrf_cookie}",
            },
        )

        self.assertEqual(rejected.status_code, 403)
        self.assertIn("CSRF token mismatch", rejected.text)

    def test_csrf_cookie_is_session_scoped_and_rotates_for_new_anonymous_sessions(
        self,
    ) -> None:
        main_module = importlib.import_module("main")
        os.environ["ALLOWED_ORIGINS"] = "http://127.0.0.1:3000"
        os.environ["CORS_ALLOW_ORIGINS"] = ""
        os.environ["AUTH_PROXY_ENABLED"] = "false"
        app = main_module.create_app()

        client_a = TestClient(app)
        client_b = TestClient(app)

        response_a = client_a.get("/health")
        client_b.get("/health")

        cookie_header_a = response_a.headers.get("set-cookie", "").lower()
        self.assertIn("csrf=", cookie_header_a)
        self.assertNotIn("expires=", cookie_header_a)
        self.assertNotIn("max-age=", cookie_header_a)
        self.assertNotEqual(client_a.cookies.get("csrf"), client_b.cookies.get("csrf"))

    def test_json_body_size_limit_is_enforced(self) -> None:
        main_module = importlib.import_module("main")
        os.environ["INPUT_MAX_BODY_BYTES"] = "1024"
        os.environ["INPUT_MAX_NESTING"] = "50"
        os.environ["ALLOWED_ORIGINS"] = "http://127.0.0.1:3000"
        os.environ["CORS_ALLOW_ORIGINS"] = ""
        app = main_module.create_app()

        @app.post("/_echo")
        def _echo(payload: dict):
            return payload

        client = TestClient(app)
        client.get("/health")
        csrf_cookie = client.cookies.get("csrf")
        response = client.post(
            "/_echo",
            json={"payload": "x" * 5000},
            headers={
                "X-CSRF": csrf_cookie or "",
                "Cookie": f"csrf={csrf_cookie or ''}",
            },
        )

        self.assertEqual(response.status_code, 413)
        self.assertIn("INPUT_MAX_BODY_BYTES", response.text)

    def test_json_nesting_limit_is_enforced(self) -> None:
        main_module = importlib.import_module("main")
        os.environ["INPUT_MAX_BODY_BYTES"] = str(1024 * 1024)
        os.environ["INPUT_MAX_NESTING"] = "3"
        os.environ["ALLOWED_ORIGINS"] = "http://127.0.0.1:3000"
        os.environ["CORS_ALLOW_ORIGINS"] = ""
        app = main_module.create_app()

        @app.post("/_echo")
        def _echo(payload: dict):
            return payload

        client = TestClient(app)
        client.get("/health")
        csrf_cookie = client.cookies.get("csrf")
        response = client.post(
            "/_echo",
            json={"a": {"b": {"c": {"d": 1}}}},
            headers={
                "X-CSRF": csrf_cookie or "",
                "Cookie": f"csrf={csrf_cookie or ''}",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("INPUT_MAX_NESTING", response.text)

    def test_deployment_request_rejects_invalid_role_ids(self) -> None:
        with self.assertRaises(ValidationError):
            DeploymentRequest(
                workspace_id="workspace-123",
                host="ssh-password",
                port=22,
                user="deploy",
                auth={"method": "password", "password": "deploy"},
                selected_roles=["Bad.Role"],
            )

    def test_workspace_generate_request_rejects_invalid_role_ids(self) -> None:
        with self.assertRaises(ValidationError):
            WorkspaceGenerateIn(
                alias="device",
                host="ssh-password",
                port=22,
                user="deploy",
                selected_roles=["Bad.Role"],
            )

    def test_workspace_credentials_request_rejects_invalid_role_ids(self) -> None:
        with self.assertRaises(ValidationError):
            WorkspaceCredentialsIn(
                master_password="secret",
                selected_roles=["Bad.Role"],
            )

    def test_state_writing_routes_do_not_accept_untyped_dict_bodies(self) -> None:
        main_module = importlib.import_module("main")
        os.environ["ALLOWED_ORIGINS"] = "http://127.0.0.1:3000"
        os.environ["CORS_ALLOW_ORIGINS"] = ""
        app = main_module.create_app()

        offenders: list[str] = []
        for route in app.router.routes:
            if not isinstance(route, APIRoute):
                continue
            methods = set(route.methods or [])
            if not methods.intersection({"POST", "PUT", "PATCH", "DELETE"}):
                continue
            if not route.path.startswith("/api/"):
                continue
            for body_param in route.dependant.body_params:
                body_type = getattr(body_param, "type_", None)
                if body_type is dict:
                    offenders.append(
                        f"{sorted(methods)} {route.path} -> {body_param.name}"
                    )
                    continue
                if inspect.isclass(body_type) and issubclass(body_type, dict):
                    offenders.append(
                        f"{sorted(methods)} {route.path} -> {body_param.name}"
                    )

        self.assertEqual(offenders, [])
