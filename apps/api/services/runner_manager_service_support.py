from __future__ import annotations

ACTIVE_JOB_STATUSES = {"queued", "running"}
TERMINAL_JOB_STATUSES = {"succeeded", "failed", "canceled"}
RUNNER_SECRETS_DIR = "/run/secrets/infinito"
RUNNER_SECRETS_READY_FILE = f"{RUNNER_SECRETS_DIR}/.ready"
RUNNER_SECRET_VOLUME_PREFIX = "infinito-job-secrets-"


def with_group_add(extra_args: list[str], gid: int | str | None) -> list[str]:
    normalized = str(gid or "").strip()
    if not normalized:
        return list(extra_args)

    index = 0
    while index < len(extra_args):
        arg = str(extra_args[index] or "").strip()
        if arg == "--group-add" and index + 1 < len(extra_args):
            if str(extra_args[index + 1] or "").strip() == normalized:
                return list(extra_args)
            index += 1
        elif arg.startswith("--group-add="):
            if arg.split("=", 1)[1].strip() == normalized:
                return list(extra_args)
        index += 1

    return [*extra_args, "--group-add", normalized]
