from __future__ import annotations

from fastapi import APIRouter

from api.schemas.infinito_nexus import (
    InfinitoNexusVersionOptionOut,
    InfinitoNexusVersionsOut,
)
from services.infinito_nexus_versions import list_infinito_nexus_versions

router = APIRouter(prefix="/infinito-nexus", tags=["infinito-nexus"])


@router.get("/versions", response_model=InfinitoNexusVersionsOut)
def list_versions() -> InfinitoNexusVersionsOut:
    records = list_infinito_nexus_versions()
    return InfinitoNexusVersionsOut(
        default_version="latest",
        versions=[
            InfinitoNexusVersionOptionOut(
                value=record.value,
                label=record.label,
                git_tag=record.git_tag,
            )
            for record in records
        ],
    )
