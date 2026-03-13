from __future__ import annotations

import hashlib
import json
import re
import socket
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from fastapi import HTTPException

from services.job_runner.paths import state_dir
from services.job_runner.util import atomic_write_json, safe_mkdir, utc_iso
from services.workspaces import WorkspaceService

_DOMAIN_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")


def _cache_path() -> Path:
    return state_dir() / "cache" / "provider_offers.json"


def _default_offers() -> List[Dict[str, Any]]:
    return [
        {
            "provider": "hetzner",
            "product_type": "vps",
            "offer_id": "cx22",
            "name": "CX22",
            "region": "fsn1",
            "location_label": "Germany",
            "cpu_cores": 2,
            "ram_gb": 4,
            "storage": {"gb": 40, "type": "ssd"},
            "network": {
                "ipv4_included": True,
                "traffic_included_gb": 20000,
                "backups": False,
                "snapshots": True,
            },
            "pricing": {"interval": "month", "currency": "EUR", "monthly_total": 4.99},
            "metadata": {"updated_at": utc_iso()},
        },
        {
            "provider": "hetzner",
            "product_type": "vps",
            "offer_id": "cx32",
            "name": "CX32",
            "region": "nbg1",
            "location_label": "Germany",
            "cpu_cores": 4,
            "ram_gb": 8,
            "storage": {"gb": 80, "type": "ssd"},
            "network": {
                "ipv4_included": True,
                "traffic_included_gb": 20000,
                "backups": True,
                "snapshots": True,
            },
            "pricing": {"interval": "month", "currency": "EUR", "monthly_total": 10.99},
            "metadata": {"updated_at": utc_iso()},
        },
        {
            "provider": "ionos",
            "product_type": "vps",
            "offer_id": "vps-s",
            "name": "VPS S",
            "region": "de-fra",
            "location_label": "Germany",
            "cpu_cores": 2,
            "ram_gb": 4,
            "storage": {"gb": 80, "type": "ssd"},
            "network": {
                "ipv4_included": True,
                "traffic_included_gb": 10000,
                "backups": True,
                "snapshots": False,
            },
            "pricing": {"interval": "month", "currency": "EUR", "monthly_total": 6.0},
            "metadata": {"updated_at": utc_iso()},
        },
        {
            "provider": "ionos",
            "product_type": "dedicated",
            "offer_id": "dedi-a8",
            "name": "Dedicated A8",
            "region": "de-ber",
            "location_label": "Germany",
            "cpu_cores": 8,
            "ram_gb": 32,
            "storage": {"gb": 480, "type": "nvme"},
            "network": {
                "ipv4_included": True,
                "traffic_included_gb": 30000,
                "backups": True,
                "snapshots": True,
            },
            "pricing": {"interval": "month", "currency": "EUR", "monthly_total": 59.0},
            "metadata": {"updated_at": utc_iso()},
        },
        {
            "provider": "ovh",
            "product_type": "vps",
            "offer_id": "vps-essential",
            "name": "VPS Essential",
            "region": "gra",
            "location_label": "France",
            "cpu_cores": 2,
            "ram_gb": 4,
            "storage": {"gb": 80, "type": "ssd"},
            "network": {
                "ipv4_included": True,
                "traffic_included_gb": 10000,
                "backups": False,
                "snapshots": False,
            },
            "pricing": {"interval": "month", "currency": "EUR", "monthly_total": 6.5},
            "metadata": {"updated_at": utc_iso()},
        },
        {
            "provider": "ovh",
            "product_type": "managed",
            "offer_id": "managed-db-s",
            "name": "Managed DB S",
            "region": "rbx",
            "location_label": "France",
            "cpu_cores": 4,
            "ram_gb": 16,
            "storage": {"gb": 200, "type": "nvme"},
            "network": {
                "ipv4_included": True,
                "traffic_included_gb": 15000,
                "backups": True,
                "snapshots": True,
            },
            "pricing": {"interval": "month", "currency": "EUR", "monthly_total": 39.9},
            "metadata": {"updated_at": utc_iso()},
        },
    ]


def _normalize_offer(raw: Dict[str, Any]) -> Dict[str, Any]:
    offer = dict(raw)
    offer["provider"] = str(offer.get("provider") or "").strip().lower()
    offer["product_type"] = str(offer.get("product_type") or "vps").strip().lower()
    offer["offer_id"] = str(offer.get("offer_id") or "").strip()
    offer["name"] = str(offer.get("name") or offer["offer_id"] or "offer").strip()
    offer["region"] = str(offer.get("region") or "global").strip().lower()
    offer["location_label"] = str(offer.get("location_label") or "Global").strip()
    offer["cpu_cores"] = int(offer.get("cpu_cores") or 1)
    offer["ram_gb"] = float(offer.get("ram_gb") or 1)
    storage = offer.get("storage")
    if not isinstance(storage, dict):
        storage = {}
    offer["storage"] = {
        "gb": float(storage.get("gb") or 20),
        "type": str(storage.get("type") or "ssd").strip().lower(),
    }
    network = offer.get("network")
    if not isinstance(network, dict):
        network = {}
    offer["network"] = {
        "ipv4_included": bool(network.get("ipv4_included", True)),
        "traffic_included_gb": float(network.get("traffic_included_gb") or 0),
        "backups": bool(network.get("backups", False)),
        "snapshots": bool(network.get("snapshots", False)),
    }
    pricing = offer.get("pricing")
    if not isinstance(pricing, dict):
        pricing = {}
    offer["pricing"] = {
        "interval": str(pricing.get("interval") or "month").strip().lower(),
        "currency": str(pricing.get("currency") or "EUR").strip().upper(),
        "monthly_total": float(pricing.get("monthly_total") or 0),
    }
    metadata = offer.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
    offer["metadata"] = {
        "updated_at": str(metadata.get("updated_at") or utc_iso()),
    }
    return offer


class ProviderCatalogService:
    def __init__(self) -> None:
        self._providers = [
            {"id": "hetzner", "name": "Hetzner", "supports": ["server", "dns"]},
            {"id": "ionos", "name": "IONOS", "supports": ["server", "dns", "domain"]},
            {"id": "ovh", "name": "OVHcloud", "supports": ["server", "dns", "domain"]},
            {"id": "aws", "name": "AWS", "supports": ["planned"]},
            {"id": "azure", "name": "Azure", "supports": ["planned"]},
        ]

    def list_providers(self) -> List[Dict[str, Any]]:
        return list(self._providers)

    def _write_default_catalog(self) -> Dict[str, Any]:
        path = _cache_path()
        safe_mkdir(path.parent)
        payload = {
            "updated_at": utc_iso(),
            "offers": [_normalize_offer(item) for item in _default_offers()],
        }
        atomic_write_json(path, payload)
        return payload

    def load_catalog(self) -> Dict[str, Any]:
        path = _cache_path()
        if not path.is_file():
            return self._write_default_catalog()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                raise ValueError("catalog root must be a mapping")
            offers = [_normalize_offer(item) for item in data.get("offers", [])]
            if not offers:
                raise ValueError("offers missing")
            updated_at = str(data.get("updated_at") or utc_iso())
            return {"updated_at": updated_at, "offers": offers}
        except Exception:
            return self._write_default_catalog()

    def offers_payload(self) -> Dict[str, Any]:
        catalog = self.load_catalog()
        updated_at = str(catalog.get("updated_at") or utc_iso())
        offers = [_normalize_offer(item) for item in catalog.get("offers", [])]
        stale = False
        try:
            ts = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
            age_hours = (datetime.now(timezone.utc) - ts).total_seconds() / 3600.0
            stale = age_hours >= 24
        except Exception:
            stale = False
        return {
            "updated_at": updated_at,
            "stale": stale,
            "offers": offers,
        }

    def find_offer(
        self, *, offer_id: str, provider: str | None = None
    ) -> Dict[str, Any]:
        wanted_offer = str(offer_id or "").strip()
        wanted_provider = str(provider or "").strip().lower()
        if not wanted_offer:
            raise HTTPException(status_code=400, detail="offer_id is required")
        for offer in self.offers_payload()["offers"]:
            if offer.get("offer_id") != wanted_offer:
                continue
            if wanted_provider and offer.get("provider") != wanted_provider:
                continue
            return offer
        raise HTTPException(status_code=404, detail="offer not found")

    def check_domain_availability(self, domain: str) -> Dict[str, Any]:
        value = str(domain or "").strip().lower().strip(".")
        if not value:
            raise HTTPException(status_code=400, detail="domain is required")
        if len(value) > 253:
            raise HTTPException(status_code=400, detail="domain too long")

        labels = value.split(".")
        if len(labels) < 2 or not all(
            _DOMAIN_LABEL_RE.match(label) for label in labels
        ):
            raise HTTPException(status_code=400, detail="invalid domain format")
        if len(labels[-1]) < 2:
            raise HTTPException(status_code=400, detail="invalid top-level domain")

        try:
            socket.getaddrinfo(value, None)
            return {
                "domain": value,
                "available": False,
                "note": "Domain resolves in DNS and is likely already registered.",
            }
        except socket.gaierror:
            return {
                "domain": value,
                "available": True,
                "note": (
                    "No DNS records found. The domain may be available, "
                    "but this is not a guaranteed registry lookup."
                ),
            }
        except Exception:
            return {
                "domain": value,
                "available": False,
                "note": "Availability check failed.",
            }

    def order_server(
        self,
        *,
        workspace_service: WorkspaceService,
        workspace_id: str,
        offer: Dict[str, Any],
        alias: str | None,
        primary_domain: str | None,
    ) -> Dict[str, Any]:
        provider = str(offer.get("provider") or "provider")
        digest = hashlib.sha256(
            f"{workspace_id}:{provider}:{offer.get('offer_id')}:{alias or ''}".encode(
                "utf-8"
            )
        ).hexdigest()
        server_id = f"{provider}-{digest[:10]}"
        default_alias = f"{provider}-{digest[:6]}"
        alias_value = (alias or "").strip() or default_alias
        host_ip = f"203.0.113.{(int(digest[0:2], 16) % 200) + 20}"
        port = 22
        user = "root"

        workspace_service.upsert_provider_device(
            workspace_id,
            alias=alias_value,
            host=host_ip,
            user=user,
            port=port,
            provider_metadata={
                "provider": provider,
                "server_id": server_id,
                "region": offer.get("region"),
            },
            primary_domain=primary_domain,
        )
        return {
            "provider": provider,
            "offer_id": offer.get("offer_id"),
            "name": offer.get("name"),
            "region": offer.get("region"),
            "specs": {
                "cpu_cores": offer.get("cpu_cores"),
                "ram_gb": offer.get("ram_gb"),
                "storage": offer.get("storage"),
            },
            "monthly_estimate": offer.get("pricing", {}).get("monthly_total"),
            "currency": offer.get("pricing", {}).get("currency"),
            "device": {
                "alias": alias_value,
                "server_id": server_id,
                "ansible_host": host_ip,
                "ansible_user": user,
                "ansible_port": port,
            },
        }
