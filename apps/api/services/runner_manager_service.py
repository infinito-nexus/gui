from __future__ import annotations

import json  # noqa: F401 - re-exported for mixins via _root()
import os  # noqa: F401 - re-exported for mixins via _root()
import shutil  # noqa: F401 - re-exported for mixins via _root()
import subprocess  # noqa: F401 - re-exported for test patchability
import threading  # noqa: F401 - re-exported for test patchability
import time  # noqa: F401 - re-exported for mixins via _root()
from dataclasses import replace  # noqa: F401 - re-exported for mixins via _root()
from datetime import datetime, timezone  # noqa: F401 - re-exported for mixins via _root()

from api.schemas.deployment_job import DeploymentJobOut  # noqa: F401 - re-exported for mixins via _root()

from services.audit_logs import AuditLogService  # noqa: F401 - re-exported for mixins via _root()
from services.job_runner.config import env_bool  # noqa: F401 - re-exported for mixins via _root()
from services.job_runner.container_runner import (  # noqa: F401 - re-exported for mixins via _root()
    build_container_command,
    create_internal_network,
    create_tmpfs_volume,
    inspect_container_labels,
    load_container_config,
    remove_container,
    remove_network,
    remove_volume,
    resolve_docker_bin,
    resolve_host_mount_source,
    stop_container,
)
from services.job_runner.log_hub import _release_process_memory  # noqa: F401 - re-exported for mixins via _root()
from services.job_runner.paths import job_paths, jobs_root  # noqa: F401 - re-exported for mixins via _root()
from services.job_runner.persistence import load_json, write_meta  # noqa: F401 - re-exported for mixins via _root()
from services.job_runner.runner import start_process, terminate_process_group  # noqa: F401 - re-exported for mixins via _root()
from services.job_runner.util import safe_mkdir, utc_iso  # noqa: F401 - re-exported for mixins via _root()
from services.workspaces.workspace_context import load_workspace_yaml_document  # noqa: F401 - re-exported for mixins via _root()

from .runner_manager_service_runtime import RunnerManagerServiceRuntimeMixin
from .runner_manager_service_support import with_group_add
from .runner_manager_service_sweep import RunnerManagerServiceSweepMixin


class RunnerManagerService(
    RunnerManagerServiceSweepMixin,
    RunnerManagerServiceRuntimeMixin,
):
    pass


_with_group_add = with_group_add
