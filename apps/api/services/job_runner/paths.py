from __future__ import annotations

import os
from pathlib import Path

from .types import JobPaths


def state_dir() -> Path:
    raw = (os.getenv("STATE_DIR", "/state") or "/state").strip()
    return Path(raw)


def jobs_root() -> Path:
    return state_dir() / "jobs"


def job_paths(job_id: str) -> JobPaths:
    job_dir = jobs_root() / job_id
    secrets_dir = job_dir / "secrets"
    return JobPaths(
        job_dir=job_dir,
        meta_path=job_dir / "job.json",
        request_path=job_dir / "request.json",
        runner_control_path=job_dir / "runner-control.json",
        inventory_path=job_dir / "inventory.yml",
        vars_json_path=job_dir / "vars.json",
        vars_yaml_path=job_dir / "vars.yml",
        ssh_key_path=job_dir / "id_rsa",
        secrets_dir=secrets_dir,
        secret_ssh_key_path=secrets_dir / "ssh_key",
        secret_ssh_password_path=secrets_dir / "ssh_password",
        secret_vault_password_path=secrets_dir / "vault_password",
        secret_kdbx_path=secrets_dir / "credentials.kdbx",
        passwd_path=job_dir / "runner-passwd",
        group_path=job_dir / "runner-group",
        sudoers_path=job_dir / "runner-sudoers",
        log_path=job_dir / "job.log",
        run_path=job_dir / "run.sh",
    )
