from ._audit_logs_service_support import *  # noqa: F403


class TestAuditLogServicePart1(AuditLogServiceTestCase):
    def test_canonical_client_ip_prefers_forwarded_header(self) -> None:
        request = _build_request(
            headers={"X-Forwarded-For": "203.0.113.7, 10.0.0.8"},
            client_host="10.0.0.5",
        )
        self.assertEqual(canonical_client_ip(request), "203.0.113.7")

    def test_canonical_client_ip_falls_back_to_unknown(self) -> None:
        request = SimpleNamespace(
            method="GET",
            url=SimpleNamespace(path="/api/workspaces/abc123/files"),
            headers=_Headers(),
            client=None,
            state=SimpleNamespace(),
        )
        self.assertEqual(canonical_client_ip(request), "unknown")

    def test_actor_identity_uses_proxy_user_when_enabled(self) -> None:
        os.environ["AUTH_PROXY_ENABLED"] = "true"
        request = _build_request(headers={"X-Auth-Request-User": "alice"})
        self.assertEqual(actor_identity(request), "alice")

    def test_request_id_uses_supported_headers(self) -> None:
        request = _build_request(headers={"X-Request-Id": "req-123"})
        self.assertEqual(request_id_from_headers(request), "req-123")

    def test_should_log_event_respects_modes_without_db(self) -> None:
        service = AuditLogService()
        self.assertTrue(
            service.should_log_event(
                workspace_id="abc123",
                method="GET",
                path="/api/workspaces/abc123/files",
                status=200,
            )
        )

    def test_build_event_uses_workspace_state_and_headers(self) -> None:
        service = AuditLogService()
        request = _build_request(
            method="POST",
            path="/api/workspaces/abc123/files/host_vars/device.yml",
            headers={
                "User-Agent": "pytest-agent",
                "X-Request-Id": "req-789",
            },
            client_host="192.0.2.44",
        )
        request.state.audit_workspace_id = "abc123"

        event = service.build_event(request=request, status=201, duration_ms=42)
        assert event is not None
        self.assertEqual(event["workspace_id"], "abc123")
        self.assertEqual(event["method"], "POST")
        self.assertEqual(
            event["path"], "/api/workspaces/abc123/files/host_vars/device.yml"
        )
        self.assertEqual(event["status"], 201)
        self.assertEqual(event["duration_ms"], 42)
        self.assertEqual(event["client_ip"], "192.0.2.44")
        self.assertEqual(event["request_id"], "req-789")
        self.assertEqual(event["user_agent"], "pytest-agent")
        self.assertEqual(event["actor"], "anonymous")

    def test_build_event_masks_free_text_fields_with_runner_secret_rules(self) -> None:
        os.environ["AUTH_PROXY_ENABLED"] = "true"
        service = AuditLogService()
        request = _build_request(
            method="POST",
            path="/api/workspaces/abc123/logs/config",
            headers={
                "User-Agent": "password=supersecret",
                "X-Request-Id": "token=tok-1234567890abcdefghijkl",
                "X-Auth-Request-User": "client_secret=topsecret",
            },
        )
        request.state.audit_workspace_id = "abc123"

        event = service.build_event(request=request, status=201, duration_ms=5)
        assert event is not None

        self.assertEqual(event["workspace_id"], "abc123")
        self.assertEqual(event["path"], "/api/workspaces/abc123/logs/config")
        self.assertEqual(event["user_agent"], "password=********")
        self.assertEqual(event["request_id"], "token=********")
        self.assertEqual(event["actor"], "client_secret=********")

    def test_should_log_event_respects_all_config_modes(self) -> None:
        service = AuditLogService()

        def allow(
            mode: str,
            *,
            method: str = "GET",
            path: str = "/api/workspaces/abc123/files",
            status: int = 200,
        ) -> bool:
            config = AuditLogConfig(workspace_id="abc123", mode=mode)
            with (
                patch.object(service, "is_enabled", return_value=True),
                patch.object(service, "get_config", return_value=config),
            ):
                return service.should_log_event(
                    workspace_id="abc123",
                    method=method,
                    path=path,
                    status=status,
                )

        self.assertTrue(allow("all"))
        self.assertTrue(allow("writes-only", method="POST"))
        self.assertFalse(allow("writes-only", method="GET"))
        self.assertTrue(allow("auth-only", path="/api/auth/session"))
        self.assertFalse(allow("auth-only", path="/api/workspaces/abc123/files"))
        self.assertTrue(allow("deployment-only", path="/api/deployments"))
        self.assertFalse(allow("deployment-only", path="/api/workspaces/abc123/files"))
        self.assertTrue(allow("errors-only", status=500))
        self.assertFalse(allow("errors-only", status=200))

    def test_should_log_event_can_exclude_health_endpoints(self) -> None:
        service = AuditLogService()
        config = AuditLogConfig(
            workspace_id="abc123",
            mode="all",
            exclude_health_endpoints=True,
        )
        with (
            patch.object(service, "is_enabled", return_value=True),
            patch.object(service, "get_config", return_value=config),
        ):
            self.assertFalse(
                service.should_log_event(
                    workspace_id="abc123",
                    method="GET",
                    path="/health",
                    status=200,
                )
            )
            self.assertFalse(
                service.should_log_event(
                    workspace_id="abc123",
                    method="GET",
                    path="/api/health",
                    status=200,
                )
            )
            self.assertTrue(
                service.should_log_event(
                    workspace_id="abc123",
                    method="GET",
                    path="/api/workspaces/abc123/files",
                    status=200,
                )
            )

    def test_build_filter_clause_includes_all_supported_filters(self) -> None:
        service = AuditLogService()
        from_ts = datetime(2026, 4, 21, 10, 0, tzinfo=timezone.utc)
        to_ts = datetime(2026, 4, 21, 11, 0, tzinfo=timezone.utc)

        where_sql, params = service._build_filter_clause(
            workspace_id="abc123",
            from_ts=from_ts,
            to_ts=to_ts,
            user="alice",
            ip="203.0.113.7",
            q="deploy",
            status=500,
            method="post",
        )

        self.assertIn("workspace_id = %s", where_sql)
        self.assertIn("timestamp >= %s", where_sql)
        self.assertIn("timestamp <= %s", where_sql)
        self.assertIn("actor = %s", where_sql)
        self.assertIn("client_ip = %s", where_sql)
        self.assertIn("status = %s", where_sql)
        self.assertIn("method = %s", where_sql)
        self.assertIn("path ILIKE %s", where_sql)
        self.assertIn("COALESCE(user_agent, '') ILIKE %s", where_sql)
        self.assertEqual(
            params,
            [
                "abc123",
                from_ts,
                to_ts,
                "alice",
                "203.0.113.7",
                500,
                "POST",
                "%deploy%",
                "%deploy%",
                "%deploy%",
                "%deploy%",
            ],
        )

    def test_encode_helpers_emit_utf8_payloads(self) -> None:
        service = AuditLogService()
        rows = [
            {
                "id": 7,
                "timestamp": datetime(2026, 4, 21, 10, 15, tzinfo=timezone.utc),
                "workspace_id": "abc123",
                "user": "alice",
                "method": "POST",
                "path": "/api/workspaces/abc123/files",
                "status": 201,
                "duration_ms": 42,
                "ip": "203.0.113.7",
                "request_id": "req-7",
                "user_agent": "pytest/ä",
            }
        ]

        jsonl = service._encode_jsonl(rows).decode("utf-8")
        csv_text = service._encode_csv(rows).decode("utf-8")

        self.assertIn('"workspace_id": "abc123"', jsonl)
        self.assertIn('"user_agent": "pytest/ä"', jsonl)
        self.assertIn('"timestamp": "2026-04-21T10:15:00Z"', jsonl)
        self.assertTrue(jsonl.endswith("\n"))
        self.assertIn(
            "workspace_id,user,method,path,status,duration_ms,ip,request_id,user_agent",
            csv_text,
        )
        self.assertIn("2026-04-21T10:15:00Z", csv_text)
        self.assertIn(
            "abc123,alice,POST,/api/workspaces/abc123/files,201,42,203.0.113.7,req-7,pytest/ä",
            csv_text,
        )
