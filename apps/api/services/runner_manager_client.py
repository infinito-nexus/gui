from __future__ import annotations

import os

import httpx
from fastapi import HTTPException

from api.schemas.deployment_job import DeploymentCancelOut, DeploymentJobOut
from api.schemas.runner_manager import RunnerManagerJobSpec

from .runner_manager_auth import manager_auth_headers


class RunnerManagerClient:
    def __init__(self, base_url: str | None = None) -> None:
        self._base_url = (base_url or os.getenv("RUNNER_MANAGER_URL") or "").strip()

    def enabled(self) -> bool:
        return bool(self._base_url)

    def _request(self, method: str, path: str, **kwargs):
        if not self._base_url:
            raise HTTPException(status_code=500, detail="RUNNER_MANAGER_URL is not set")
        headers = dict(kwargs.pop("headers", {}) or {})
        headers.update(manager_auth_headers())
        try:
            with httpx.Client(
                base_url=self._base_url,
                timeout=httpx.Timeout(30.0, connect=5.0),
            ) as client:
                response = client.request(method, path, headers=headers, **kwargs)
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"runner-manager request failed: {exc}",
            ) from exc

        if response.status_code >= 400:
            detail = None
            try:
                detail = response.json().get("detail")
            except Exception:
                detail = response.text.strip() or None
            raise HTTPException(
                status_code=response.status_code,
                detail=detail or "runner-manager request failed",
            )
        return response

    def start_job(self, spec: RunnerManagerJobSpec) -> DeploymentJobOut:
        response = self._request("POST", "/jobs", json=spec.model_dump(mode="json"))
        return DeploymentJobOut.model_validate(response.json())

    def cancel_job(
        self,
        job_id: str,
        *,
        workspace_id: str | None = None,
    ) -> DeploymentCancelOut:
        params = {"workspace_id": workspace_id} if workspace_id else None
        response = self._request("DELETE", f"/jobs/{job_id}", params=params)
        return DeploymentCancelOut.model_validate(response.json())

    def get_job(
        self,
        job_id: str,
        *,
        workspace_id: str | None = None,
    ) -> DeploymentJobOut:
        params = {"workspace_id": workspace_id} if workspace_id else None
        response = self._request("GET", f"/jobs/{job_id}", params=params)
        return DeploymentJobOut.model_validate(response.json())

    def list_jobs(
        self,
        *,
        workspace_id: str | None = None,
        status: str | None = None,
    ) -> list[DeploymentJobOut]:
        params = {
            key: value
            for key, value in {
                "workspace_id": workspace_id,
                "status": status,
            }.items()
            if value
        }
        response = self._request("GET", "/jobs", params=params or None)
        return [
            DeploymentJobOut.model_validate(item) for item in list(response.json() or [])
        ]
