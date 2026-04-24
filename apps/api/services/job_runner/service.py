from __future__ import annotations

import copy  # noqa: F401 - re-exported for mixins via _root()
import os  # noqa: F401 - re-exported for mixins via _root()
import shlex  # noqa: F401 - re-exported for mixins via _root()
import shutil  # noqa: F401 - re-exported for mixins via _root()
import threading  # noqa: F401 - re-exported for test patchability
import time  # noqa: F401 - re-exported for test patchability
import uuid  # noqa: F401 - re-exported for mixins via _root()
from dataclasses import replace  # noqa: F401 - re-exported for mixins via _root()
from pathlib import Path  # noqa: F401 - re-exported for mixins via _root()

import yaml  # noqa: F401 - re-exported for mixins via _root()

from fastapi import HTTPException  # noqa: F401 - re-exported for mixins via _root()

from api.schemas.deployment_job import DeploymentJobOut  # noqa: F401 - re-exported for mixins via _root()
from api.schemas.runner_manager import RunnerManagerJobSpec  # noqa: F401 - re-exported for mixins via _root()

from services.infinito_nexus_versions import (  # noqa: F401 - re-exported for mixins via _root()
    normalize_infinito_nexus_version,
    resolve_job_runner_image,
)
from services.inventory_preview import build_inventory_preview  # noqa: F401 - re-exported for mixins via _root()
from services.runner_manager_client import RunnerManagerClient  # noqa: F401 - re-exported for mixins via _root()
from services.workspaces import WorkspaceService  # noqa: F401 - re-exported for mixins via _root()
from services.workspaces.vault import KDBX_FILENAME, _vault_password_from_kdbx  # noqa: F401 - re-exported for mixins via _root()
from services.workspaces.workspace_context import (  # noqa: F401 - re-exported for mixins via _root()
    _WorkspaceYamlDumper,
    load_workspace_yaml_document,
)

from .config import env_bool  # noqa: F401 - re-exported for mixins via _root()
from .container_runner import (  # noqa: F401 - re-exported for mixins via _root()
    build_container_command,
    load_container_config,
    resolve_host_mount_source,
)
from .job_runner_args import JobRunnerServiceArgsMixin
from .job_runner_runtime import JobRunnerServiceRuntimeMixin
from .job_runner_workspace import JobRunnerServiceWorkspaceMixin
from .log_hub import LogHub, _release_process_memory  # noqa: F401 - re-exported for mixins via _root()
from .related_roles import discover_related_role_domains  # noqa: F401 - re-exported for mixins via _root()
from .runner import (  # noqa: F401 - re-exported for mixins via _root()
    start_process,
    terminate_process_group,
    write_runner_script,
)
from .paths import job_paths, jobs_root  # noqa: F401 - re-exported for mixins via _root()
from .persistence import load_json, mask_request_for_persistence, write_meta  # noqa: F401 - re-exported for mixins via _root()
from .secrets import collect_secrets  # noqa: F401 - re-exported for mixins via _root()
from .shims import (  # noqa: F401 - re-exported for mixins via _root()
    write_controller_shims,
    write_infinito_shim,
    write_local_sudo_shim,
    write_runtime_command_shims,
)
from .util import atomic_write_json, atomic_write_text, safe_mkdir, utc_iso  # noqa: F401 - re-exported for mixins via _root()

WORKSPACE_SKIP_FILES = {"workspace.json", "credentials.kdbx"}
RUNNER_PASSWD = """root:x:0:0:root:/root:/bin/sh
runner:x:10002:10002:Infinito Runner:/tmp/infinito-home:/usr/bin/nologin
"""
RUNNER_GROUP = """root:x:0:
runner:x:10002:
"""
RUNNER_SUDOERS = "runner ALL=(ALL) NOPASSWD:ALL\n"
WORKSPACE_HOST_VAR_OVERRIDE_KEYS = ("users", "applications")


class JobRunnerService(
    JobRunnerServiceWorkspaceMixin,
    JobRunnerServiceRuntimeMixin,
    JobRunnerServiceArgsMixin,
):
    """
    Filesystem-based job runner.

    Layout:
      ${STATE_DIR}/jobs/<job_id>/
        job.json        (status, pid, timestamps)
        request.json    (masked request - no secrets)
        inventory.yml   (copied from workspace)
        job.log         (stdout/stderr of runner)
        run.sh          (runner script)
    """
