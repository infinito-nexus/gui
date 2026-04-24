from __future__ import annotations


from .workspace_service_artifacts_credentials import (
    WorkspaceServiceArtifactsCredentialsMixin,
)
from .workspace_service_artifacts_zip import WorkspaceServiceArtifactsZipMixin


class WorkspaceServiceArtifactsMixin(
    WorkspaceServiceArtifactsCredentialsMixin,
    WorkspaceServiceArtifactsZipMixin,
):
    pass
