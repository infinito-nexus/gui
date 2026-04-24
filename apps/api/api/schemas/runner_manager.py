from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Dict, List

from pydantic import BaseModel, Field, field_validator, model_validator

from api.schemas.deployment import ROLE_ID_RE

_UUID4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
_NETWORK_NAME_RE = re.compile(
    r"^job-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
_DIGEST_IMAGE_RE = re.compile(r"^.+@sha256:[0-9a-f]{64}$")
_MANAGER_LABEL_KEYS = {
    "infinito.deployer.job_id",
    "infinito.deployer.workspace_id",
    "infinito.deployer.role",
}


def _env_truthy(name: str) -> bool:
    value = str(os.getenv(name) or "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _digest_pinning_required() -> bool:
    if (os.getenv("INFINITO_NEXUS_SRC_DIR") or "").strip():
        return False
    if "INFINITO_ENFORCE_DIGEST_PINNING" in os.environ:
        return _env_truthy("INFINITO_ENFORCE_DIGEST_PINNING")
    return _env_truthy("CI") or _env_truthy("GITHUB_ACTIONS")


class RunnerManagerJobSpec(BaseModel):
    job_id: str = Field(..., min_length=1)
    workspace_id: str = Field(..., min_length=1)
    runner_image: str = Field(..., min_length=1)
    inventory_path: str = Field(..., min_length=1)
    secrets_dir: str = Field(..., min_length=1)
    role_ids: List[str] = Field(default_factory=list)
    network_name: str = Field(..., min_length=1)
    labels: Dict[str, str] = Field(default_factory=dict)

    model_config = {"extra": "forbid"}

    @field_validator(
        "job_id",
        "workspace_id",
        "runner_image",
        "inventory_path",
        "secrets_dir",
        "network_name",
    )
    @classmethod
    def _strip_required(cls, value: str) -> str:
        cleaned = str(value or "").strip()
        if not cleaned:
            raise ValueError("must not be empty")
        return cleaned

    @field_validator("job_id")
    @classmethod
    def _validate_job_id(cls, value: str) -> str:
        lowered = value.lower()
        if not _UUID4_RE.match(lowered):
            raise ValueError("job_id must be a UUIDv4 string")
        return lowered

    @field_validator("runner_image")
    @classmethod
    def _validate_runner_image(cls, value: str) -> str:
        if _DIGEST_IMAGE_RE.match(value):
            return value
        if not _digest_pinning_required():
            return value
        raise ValueError(
            "runner_image must be digest-pinned when CI/prod digest pinning is enabled"
        )

    @field_validator("inventory_path")
    @classmethod
    def _reject_absolute_or_parent_inventory_paths(cls, value: str) -> str:
        if value.startswith("/") or ".." in value.split("/"):
            raise ValueError("must be workspace-relative")
        return value

    @field_validator("secrets_dir")
    @classmethod
    def _require_absolute_secrets_dir(cls, value: str) -> str:
        path = Path(value)
        if not path.is_absolute() or ".." in path.parts:
            raise ValueError("secrets_dir must be an absolute host path")
        return str(path)

    @field_validator("network_name")
    @classmethod
    def _validate_network_name(cls, value: str) -> str:
        if not _NETWORK_NAME_RE.match(value):
            raise ValueError("invalid network name")
        return value

    @field_validator("role_ids")
    @classmethod
    def _validate_role_ids(cls, values: List[str]) -> List[str]:
        cleaned: List[str] = []
        seen: set[str] = set()
        for value in values or []:
            role_id = str(value or "").strip()
            if not role_id:
                continue
            if not ROLE_ID_RE.match(role_id):
                raise ValueError(
                    "role_ids entries must match ^[a-z0-9][a-z0-9\\-_]{0,63}$"
                )
            if role_id not in seen:
                cleaned.append(role_id)
                seen.add(role_id)
        return cleaned

    @field_validator("labels")
    @classmethod
    def _validate_labels(cls, values: Dict[str, str]) -> Dict[str, str]:
        cleaned: Dict[str, str] = {}
        for key, value in dict(values or {}).items():
            label_key = str(key or "").strip()
            label_value = str(value or "").strip()
            if not label_key or not label_value:
                raise ValueError("labels must contain non-empty keys and values")
            if label_key not in _MANAGER_LABEL_KEYS:
                raise ValueError(f"unsupported label: {label_key}")
            cleaned[label_key] = label_value
        return cleaned

    @model_validator(mode="after")
    def _require_documented_labels(self) -> "RunnerManagerJobSpec":
        missing = sorted(_MANAGER_LABEL_KEYS.difference(self.labels))
        if missing:
            raise ValueError(f"missing labels: {', '.join(missing)}")
        if self.labels["infinito.deployer.workspace_id"] != self.workspace_id:
            raise ValueError("workspace label must match workspace_id")
        if self.labels["infinito.deployer.job_id"] != self.job_id:
            raise ValueError("job label must match job_id")
        if self.labels["infinito.deployer.role"] != "job-runner":
            raise ValueError("role label must equal job-runner")
        if self.network_name != f"job-{self.job_id}":
            raise ValueError("network name must equal job-<job_id>")
        return self
