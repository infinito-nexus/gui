from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
import threading

from .artifacts.main import WorkspaceServiceArtifactsMixin
from .domains import WorkspaceServiceDomainsMixin
from .history.main import WorkspaceServiceHistoryMixin
from .inventory import WorkspaceServiceInventoryMixin
from .management import WorkspaceServiceManagementMixin
from .orders import WorkspaceServiceOrdersMixin
from .rbac import WorkspaceServiceRBACMixin
from .security import WorkspaceServiceSecurityMixin


class WorkspaceService(
    WorkspaceServiceHistoryMixin,
    WorkspaceServiceManagementMixin,
    WorkspaceServiceOrdersMixin,
    WorkspaceServiceDomainsMixin,
    WorkspaceServiceRBACMixin,
    WorkspaceServiceInventoryMixin,
    WorkspaceServiceArtifactsMixin,
    WorkspaceServiceSecurityMixin,
):
    _workspace_locks_guard = threading.Lock()
    _workspace_locks: dict[str, threading.RLock] = {}

    @contextmanager
    def workspace_write_lock(self, workspace_id: str) -> Iterator[None]:
        normalized = str(workspace_id or "").strip()
        if not normalized:
            raise ValueError("workspace_id is required for workspace_write_lock")
        cls = type(self)
        with cls._workspace_locks_guard:
            lock = cls._workspace_locks.get(normalized)
            if lock is None:
                lock = threading.RLock()
                cls._workspace_locks[normalized] = lock
        with lock:
            yield
