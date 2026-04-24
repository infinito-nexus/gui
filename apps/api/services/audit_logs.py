from __future__ import annotations

import threading  # noqa: F401 - re-exported for test patchability

from .audit_logs_bootstrap import AuditLogServiceBootstrapMixin
from .audit_logs_query import AuditLogServiceQueryMixin
from .audit_logs_support import (
    AuditLogConfig,
    actor_identity,
    canonical_client_ip,
    encode_csv,
    encode_jsonl,
    request_id_from_headers,
    row_to_entry,
)

__all__ = [
    "AuditLogConfig",
    "AuditLogService",
    "actor_identity",
    "canonical_client_ip",
    "encode_csv",
    "encode_jsonl",
    "request_id_from_headers",
    "row_to_entry",
]


class AuditLogService(AuditLogServiceBootstrapMixin, AuditLogServiceQueryMixin):
    def _row_to_entry(self, row):
        return row_to_entry(list(row))

    def _encode_jsonl(self, rows):
        return encode_jsonl(rows)

    def _encode_csv(self, rows):
        return encode_csv(rows)
