from __future__ import annotations

from functools import lru_cache
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request

from api.auth import ensure_workspace_access
from api.schemas.provider import (
    ProviderDomainAvailabilityOut,
    ProviderDnsZoneIn,
    ProviderDnsZoneOut,
    ProviderListOut,
    ProviderOffersOut,
    ProviderOrderDomainIn,
    ProviderOrderDomainOut,
    ProviderOrderServerIn,
    ProviderOrderServerOut,
    ProviderPrimaryDomainIn,
    ProviderPrimaryDomainOut,
)
from services.providers import ProviderCatalogService
from services.workspaces import WorkspaceService

router = APIRouter(prefix="/providers", tags=["providers"])


@lru_cache(maxsize=1)
def _providers() -> ProviderCatalogService:
    return ProviderCatalogService()


@lru_cache(maxsize=1)
def _workspaces() -> WorkspaceService:
    return WorkspaceService()


@router.get("", response_model=ProviderListOut)
def list_providers() -> ProviderListOut:
    return ProviderListOut(providers=_providers().list_providers())


@router.get("/offers", response_model=ProviderOffersOut)
def list_provider_offers(
    provider: Optional[str] = Query(default=None),
    product_type: Optional[str] = Query(default=None),
    region: Optional[str] = Query(default=None),
    cpu_min: Optional[float] = Query(default=None, ge=0),
    ram_min: Optional[float] = Query(default=None, ge=0),
    storage_min: Optional[float] = Query(default=None, ge=0),
    storage_type: Optional[str] = Query(default=None),
    price_min: Optional[float] = Query(default=None, ge=0),
    price_max: Optional[float] = Query(default=None, ge=0),
    currency: Optional[str] = Query(default=None),
    ipv4_included: Optional[bool] = Query(default=None),
    backups: Optional[bool] = Query(default=None),
    snapshots: Optional[bool] = Query(default=None),
) -> ProviderOffersOut:
    payload = _providers().offers_payload()
    offers = payload.get("offers", [])

    wanted_provider = str(provider or "").strip().lower()
    wanted_type = str(product_type or "").strip().lower()
    wanted_region = str(region or "").strip().lower()
    wanted_storage = str(storage_type or "").strip().lower()
    wanted_currency = str(currency or "").strip().upper()

    filtered = []
    for offer in offers:
        if (
            wanted_provider
            and str(offer.get("provider") or "").lower() != wanted_provider
        ):
            continue
        if wanted_type and str(offer.get("product_type") or "").lower() != wanted_type:
            continue
        if wanted_region and str(offer.get("region") or "").lower() != wanted_region:
            continue
        if cpu_min is not None and float(offer.get("cpu_cores") or 0) < float(cpu_min):
            continue
        if ram_min is not None and float(offer.get("ram_gb") or 0) < float(ram_min):
            continue
        storage = offer.get("storage") or {}
        if storage_min is not None and float(storage.get("gb") or 0) < float(
            storage_min
        ):
            continue
        if wanted_storage and str(storage.get("type") or "").lower() != wanted_storage:
            continue
        pricing = offer.get("pricing") or {}
        if (
            wanted_currency
            and str(pricing.get("currency") or "").upper() != wanted_currency
        ):
            continue
        price_value = float(pricing.get("monthly_total") or 0)
        if price_min is not None and price_value < float(price_min):
            continue
        if price_max is not None and price_value > float(price_max):
            continue
        network = offer.get("network") or {}
        if (
            ipv4_included is not None
            and bool(network.get("ipv4_included")) != ipv4_included
        ):
            continue
        if backups is not None and bool(network.get("backups")) != backups:
            continue
        if snapshots is not None and bool(network.get("snapshots")) != snapshots:
            continue
        filtered.append(offer)

    return ProviderOffersOut(
        updated_at=str(payload.get("updated_at") or ""),
        stale=bool(payload.get("stale", False)),
        offers=filtered,
    )


@router.post("/order/server", response_model=ProviderOrderServerOut)
def order_server(
    payload: ProviderOrderServerIn, request: Request
) -> ProviderOrderServerOut:
    if not payload.confirm:
        raise HTTPException(
            status_code=400,
            detail="explicit confirmation required before provisioning",
        )
    ensure_workspace_access(request, payload.workspace_id, _workspaces())
    offer = _providers().find_offer(
        offer_id=payload.offer_id, provider=payload.provider
    )
    result = _providers().order_server(
        workspace_service=_workspaces(),
        workspace_id=payload.workspace_id,
        offer=offer,
        alias=payload.alias,
        primary_domain=payload.primary_domain,
    )
    return ProviderOrderServerOut(**result)


@router.post("/order/domain", response_model=ProviderOrderDomainOut)
def order_domain(payload: ProviderOrderDomainIn) -> ProviderOrderDomainOut:
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="explicit confirmation required")
    return ProviderOrderDomainOut(
        ok=True,
        provider=payload.provider.strip().lower(),
        domain=payload.domain.strip().lower(),
        note="Domain ordering is queued (mocked provider flow).",
    )


@router.get("/domain-availability", response_model=ProviderDomainAvailabilityOut)
def domain_availability(
    domain: str = Query(..., min_length=1),
) -> ProviderDomainAvailabilityOut:
    result = _providers().check_domain_availability(domain)
    return ProviderDomainAvailabilityOut(**result)


@router.post("/dns/zone", response_model=ProviderDnsZoneOut)
def create_dns_zone(payload: ProviderDnsZoneIn) -> ProviderDnsZoneOut:
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="explicit confirmation required")
    return ProviderDnsZoneOut(
        ok=True,
        provider=payload.provider.strip().lower(),
        domain=payload.domain.strip().lower(),
        records=payload.records,
        note="DNS zone changes are queued (mocked provider flow).",
    )


@router.put("/primary-domain", response_model=ProviderPrimaryDomainOut)
def set_primary_domain(
    payload: ProviderPrimaryDomainIn, request: Request
) -> ProviderPrimaryDomainOut:
    ensure_workspace_access(request, payload.workspace_id, _workspaces())
    result = _workspaces().set_primary_domain(
        payload.workspace_id,
        alias=payload.alias,
        primary_domain=payload.primary_domain,
    )
    return ProviderPrimaryDomainOut(**result)
