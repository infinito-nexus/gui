from __future__ import annotations

from functools import lru_cache

from fastapi import Depends, FastAPI, Query
from fastapi.responses import StreamingResponse

from api.schemas.deployment_job import DeploymentCancelOut, DeploymentJobOut
from api.schemas.runner_manager import RunnerManagerJobSpec
from services.runner_manager_auth import require_manager_token
from services.runner_manager_service import RunnerManagerService


@lru_cache(maxsize=1)
def _service() -> RunnerManagerService:
    return RunnerManagerService()


def create_app() -> FastAPI:
    app = FastAPI(title="Infinito Runner Manager", version="0.1.0")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post(
        "/jobs",
        response_model=DeploymentJobOut,
        dependencies=[Depends(require_manager_token)],
    )
    def create_job(spec: RunnerManagerJobSpec) -> DeploymentJobOut:
        return _service().create(spec)

    @app.delete(
        "/jobs/{job_id}",
        response_model=DeploymentCancelOut,
        dependencies=[Depends(require_manager_token)],
    )
    def delete_job(
        job_id: str,
        workspace_id: str | None = Query(default=None),
    ) -> DeploymentCancelOut:
        return DeploymentCancelOut(
            ok=_service().cancel(job_id, workspace_id=workspace_id)
        )

    @app.get(
        "/jobs/{job_id}",
        response_model=DeploymentJobOut,
        dependencies=[Depends(require_manager_token)],
    )
    def get_job(
        job_id: str,
        workspace_id: str | None = Query(default=None),
    ) -> DeploymentJobOut:
        return _service().get(job_id, workspace_id=workspace_id)

    @app.get(
        "/jobs",
        response_model=list[DeploymentJobOut],
        dependencies=[Depends(require_manager_token)],
    )
    def list_jobs(
        workspace_id: str | None = Query(default=None),
        status: str | None = Query(default=None),
    ) -> list[DeploymentJobOut]:
        return _service().list_jobs(workspace_id=workspace_id, status=status)

    @app.get(
        "/jobs/{job_id}/logs",
        dependencies=[Depends(require_manager_token)],
    )
    def stream_logs(
        job_id: str,
        workspace_id: str | None = Query(default=None),
    ) -> StreamingResponse:
        return StreamingResponse(
            _service().stream_logs(job_id, workspace_id=workspace_id),
            media_type="text/plain; charset=utf-8",
        )

    return app


app = create_app()
