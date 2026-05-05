from __future__ import annotations

import subprocess  # noqa: F401 - re-exported for test patchability

from ...vault import _vault_password_from_kdbx  # noqa: F401 - re-exported for test patchability
from ..context import _safe_resolve  # noqa: F401 - re-exported for test patchability
from .credentials import (
    WorkspaceServiceArtifactsCredentialsMixin,
)
from .zip import WorkspaceServiceArtifactsZipMixin


class WorkspaceServiceArtifactsMixin(
    WorkspaceServiceArtifactsCredentialsMixin,
    WorkspaceServiceArtifactsZipMixin,
):
    pass
