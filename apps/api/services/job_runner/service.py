from __future__ import annotations




from .job_runner_args import JobRunnerServiceArgsMixin
from .job_runner_runtime import JobRunnerServiceRuntimeMixin
from .job_runner_workspace import JobRunnerServiceWorkspaceMixin

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

