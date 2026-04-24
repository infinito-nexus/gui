from __future__ import annotations

import subprocess  # noqa: F401 - re-exported for test patchability

from .vault import _vault_password_from_kdbx  # noqa: F401 - re-exported for test patchability
from .workspace_context import _safe_resolve  # noqa: F401 - re-exported for test patchability
from .workspace_service_artifacts_credentials import (
    WorkspaceServiceArtifactsCredentialsMixin,
)
from .workspace_service_artifacts_zip import WorkspaceServiceArtifactsZipMixin


class WorkspaceServiceArtifactsMixin(
    WorkspaceServiceArtifactsCredentialsMixin,
    WorkspaceServiceArtifactsZipMixin,
):
    pass
