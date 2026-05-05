"""Unit tests for the auth context (groups + is_administrator)."""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from fastapi import Request

from api.auth import (
    ADMIN_GROUP,
    AuthContext,
    _parse_groups,
    resolve_auth_context,
)


def _make_request(headers: dict[str, str]) -> Request:
    """Build a minimal ASGI Request stub for header reads."""
    encoded = [
        (key.lower().encode("latin-1"), value.encode("latin-1"))
        for key, value in headers.items()
    ]
    scope = {"type": "http", "headers": encoded}
    return Request(scope)


class TestParseGroups(unittest.TestCase):
    def test_comma_separated(self) -> None:
        self.assertEqual(
            _parse_groups("administrator, billing, support"),
            ("administrator", "billing", "support"),
        )

    def test_semicolon_alias_and_dedup(self) -> None:
        self.assertEqual(
            _parse_groups("admin; billing,billing"),
            ("admin", "billing"),
        )

    def test_empty(self) -> None:
        self.assertEqual(_parse_groups(""), ())
        self.assertEqual(_parse_groups("   "), ())


class TestAuthContextProps(unittest.TestCase):
    def test_authenticated_requires_user_id(self) -> None:
        self.assertFalse(AuthContext(proxy_enabled=True).authenticated)
        self.assertTrue(AuthContext(proxy_enabled=True, user_id="alice").authenticated)

    def test_is_administrator_via_group(self) -> None:
        ctx = AuthContext(
            proxy_enabled=True, user_id="alice", groups=(ADMIN_GROUP, "billing")
        )
        self.assertTrue(ctx.is_administrator)

    def test_is_administrator_false_without_group(self) -> None:
        ctx = AuthContext(proxy_enabled=True, user_id="alice", groups=("billing",))
        self.assertFalse(ctx.is_administrator)

    def test_dev_admin_env_promotes_local_user(self) -> None:
        ctx = AuthContext(proxy_enabled=False, user_id="dev")
        with patch.dict(os.environ, {"AUTH_DEV_ADMIN": "true"}, clear=False):
            self.assertTrue(ctx.is_administrator)

    def test_dev_admin_env_off_keeps_non_admin(self) -> None:
        ctx = AuthContext(proxy_enabled=False, user_id="dev")
        with patch.dict(os.environ, {"AUTH_DEV_ADMIN": "false"}, clear=False):
            self.assertFalse(ctx.is_administrator)

    def test_dev_admin_env_does_not_promote_anonymous(self) -> None:
        ctx = AuthContext(proxy_enabled=False, user_id=None)
        with patch.dict(os.environ, {"AUTH_DEV_ADMIN": "true"}, clear=False):
            self.assertFalse(ctx.is_administrator)


class TestResolveAuthContext(unittest.TestCase):
    def test_disabled_proxy_returns_anonymous(self) -> None:
        with patch.dict(os.environ, {"AUTH_PROXY_ENABLED": "false"}, clear=False):
            ctx = resolve_auth_context(_make_request({}))
        self.assertFalse(ctx.proxy_enabled)
        self.assertIsNone(ctx.user_id)
        self.assertEqual(ctx.groups, ())

    def test_proxy_reads_user_email_groups(self) -> None:
        env = {
            "AUTH_PROXY_ENABLED": "true",
        }
        headers = {
            "X-Auth-Request-User": "alice",
            "X-Auth-Request-Email": "alice@example.org",
            "X-Auth-Request-Groups": "administrator, billing",
        }
        with patch.dict(os.environ, env, clear=False):
            ctx = resolve_auth_context(_make_request(headers))
        self.assertTrue(ctx.proxy_enabled)
        self.assertEqual(ctx.user_id, "alice")
        self.assertEqual(ctx.email, "alice@example.org")
        self.assertEqual(ctx.groups, ("administrator", "billing"))
        self.assertTrue(ctx.is_administrator)


if __name__ == "__main__":
    unittest.main()
