from __future__ import annotations


from .audit_logs_bootstrap import AuditLogServiceBootstrapMixin
from .audit_logs_query import AuditLogServiceQueryMixin
from .audit_logs_support import (
    encode_csv,
    encode_jsonl,
    row_to_entry,
)


class AuditLogService(AuditLogServiceBootstrapMixin, AuditLogServiceQueryMixin):
    def _row_to_entry(self, row):
        return row_to_entry(list(row))

    def _encode_jsonl(self, rows):
        return encode_jsonl(rows)

    def _encode_csv(self, rows):
        return encode_csv(rows)
