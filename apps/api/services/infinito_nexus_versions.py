from __future__ import annotations

import os
import re
import threading
import time
from dataclasses import dataclass
from typing import Any, Iterable, Optional
from urllib.parse import quote

import httpx
from fastapi import HTTPException

_DEFAULT_REPO = "kevinveenbirkenbach/infinito-nexus"
_DEFAULT_PACKAGE = "kevinveenbirkenbach/infinito-nexus-core"
_DEFAULT_TIMEOUT_SECONDS = 10.0
_DEFAULT_CACHE_TTL_SECONDS = 900
_STABLE_SEMVER_RE = re.compile(r"^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")

_CACHE_LOCK = threading.Lock()
_CACHE: dict[str, Any] = {
    "expires_at": 0.0,
    "records": None,
}


@dataclass(frozen=True)
class InfinitoNexusVersionRecord:
    value: str
    label: str
    git_tag: Optional[str]
    image_tag: str
    commit_sha: Optional[str]


def _repo_slug() -> str:
    return (os.getenv("INFINITO_NEXUS_TAGS_REPO") or _DEFAULT_REPO).strip()


def _package_slug() -> str:
    return (os.getenv("INFINITO_NEXUS_PACKAGE") or _DEFAULT_PACKAGE).strip()


def _cache_ttl_seconds() -> int:
    raw = (os.getenv("INFINITO_NEXUS_VERSIONS_CACHE_TTL") or "").strip()
    if not raw:
        return _DEFAULT_CACHE_TTL_SECONDS
    try:
        return max(int(raw), 0)
    except ValueError:
        return _DEFAULT_CACHE_TTL_SECONDS


def _parse_repo_slug() -> tuple[str, str]:
    slug = _repo_slug()
    if "/" not in slug:
        raise HTTPException(
            status_code=500,
            detail="INFINITO_NEXUS_TAGS_REPO must look like <owner>/<repo>",
        )
    owner, repo = slug.split("/", 1)
    owner = owner.strip()
    repo = repo.strip()
    if not owner or not repo:
        raise HTTPException(
            status_code=500,
            detail="INFINITO_NEXUS_TAGS_REPO must look like <owner>/<repo>",
        )
    return owner, repo


def _parse_package_slug() -> tuple[str, str]:
    slug = _package_slug()
    if "/" not in slug:
        raise HTTPException(
            status_code=500,
            detail="INFINITO_NEXUS_PACKAGE must look like <owner>/<package>",
        )
    owner, package = slug.split("/", 1)
    owner = owner.strip()
    package = package.strip()
    if not owner or not package:
        raise HTTPException(
            status_code=500,
            detail="INFINITO_NEXUS_PACKAGE must look like <owner>/<package>",
        )
    return owner, package


def normalize_infinito_nexus_version(value: str | None) -> str:
    text = str(value or "").strip()
    if not text or text.lower() == "latest":
        return "latest"
    match = _STABLE_SEMVER_RE.match(text)
    if not match:
        raise HTTPException(
            status_code=400,
            detail="invalid infinito_nexus_version (expected latest or stable semver)",
        )
    return ".".join(match.groups())


def _replace_image_tag(image: str, tag: str) -> str:
    base = (image or "").strip()
    if not base:
        raise HTTPException(
            status_code=500,
            detail="JOB_RUNNER_IMAGE (or INFINITO_NEXUS_IMAGE) must be set",
        )
    digest_sep = base.find("@")
    if digest_sep != -1:
        base = base[:digest_sep]
    last_slash = base.rfind("/")
    last_colon = base.rfind(":")
    if last_colon > last_slash:
        base = base[:last_colon]
    return f"{base}:{tag}"


def _http_timeout() -> float:
    raw = (os.getenv("INFINITO_NEXUS_VERSIONS_TIMEOUT") or "").strip()
    if not raw:
        return _DEFAULT_TIMEOUT_SECONDS
    try:
        return max(float(raw), 1.0)
    except ValueError:
        return _DEFAULT_TIMEOUT_SECONDS


def _fetch_repo_tags() -> list[dict[str, Any]]:
    owner, repo = _parse_repo_slug()
    page = 1
    items: list[dict[str, Any]] = []
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "infinito-deployer",
    }
    timeout = _http_timeout()
    with httpx.Client(timeout=timeout, headers=headers) as client:
        while True:
            response = client.get(
                f"https://api.github.com/repos/{owner}/{repo}/tags",
                params={"per_page": 100, "page": page},
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, list) or len(payload) == 0:
                break
            items.extend(item for item in payload if isinstance(item, dict))
            if len(payload) < 100:
                break
            page += 1
    return items


def _github_headers() -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "infinito-deployer",
    }
    token = (
        os.getenv("INFINITO_NEXUS_GITHUB_TOKEN") or os.getenv("GH_TOKEN") or ""
    ).strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _fetch_package_tags() -> list[str]:
    owner, package = _parse_package_slug()
    page = 1
    tags: list[str] = []
    timeout = _http_timeout()
    with httpx.Client(timeout=timeout, headers=_github_headers()) as client:
        while True:
            response = client.get(
                "https://api.github.com/users/"
                f"{owner}/packages/container/{quote(package, safe='')}/versions",
                params={"per_page": 100, "page": page},
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, list) or len(payload) == 0:
                break
            for item in payload:
                if not isinstance(item, dict):
                    continue
                metadata = (
                    item.get("metadata")
                    if isinstance(item.get("metadata"), dict)
                    else {}
                )
                container = (
                    metadata.get("container")
                    if isinstance(metadata.get("container"), dict)
                    else {}
                )
                raw_tags = container.get("tags")
                if not isinstance(raw_tags, list):
                    continue
                for raw_tag in raw_tags:
                    tag = str(raw_tag or "").strip()
                    if tag:
                        tags.append(tag)
            if len(payload) < 100:
                break
            page += 1
    return tags


def _sort_key(version: str) -> tuple[int, int, int]:
    match = _STABLE_SEMVER_RE.match(version)
    if not match:
        return (0, 0, 0)
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]


def _build_records(tags: Iterable[str]) -> list[InfinitoNexusVersionRecord]:
    deduped: dict[str, InfinitoNexusVersionRecord] = {}
    latest_available = False
    for item in tags:
        raw_name = str(item or "").strip()
        if raw_name.lower() == "latest":
            latest_available = True
            continue
        match = _STABLE_SEMVER_RE.match(raw_name)
        if not match:
            continue
        version = ".".join(match.groups())
        if version in deduped:
            continue
        deduped[version] = InfinitoNexusVersionRecord(
            value=version,
            label=version,
            git_tag=raw_name,
            image_tag=raw_name,
            commit_sha=None,
        )

    ordered = sorted(
        deduped.values(), key=lambda record: _sort_key(record.value), reverse=True
    )
    latest_image_tag = "latest"
    if not latest_available and ordered:
        latest_image_tag = ordered[0].image_tag
    return [
        InfinitoNexusVersionRecord(
            value="latest",
            label="latest",
            git_tag=None,
            image_tag=latest_image_tag,
            commit_sha=None,
        ),
        *ordered,
    ]


def list_infinito_nexus_versions(
    *, force_refresh: bool = False
) -> list[InfinitoNexusVersionRecord]:
    now = time.time()
    ttl = _cache_ttl_seconds()
    cached = None
    with _CACHE_LOCK:
        cached = _CACHE.get("records")
        expires_at = float(_CACHE.get("expires_at") or 0.0)
        if (
            not force_refresh
            and isinstance(cached, list)
            and len(cached) > 0
            and (ttl == 0 or now < expires_at)
        ):
            return list(cached)

    try:
        try:
            records = _build_records(_fetch_package_tags())
        except Exception:
            records = _build_records(
                [str(item.get("name") or "").strip() for item in _fetch_repo_tags()]
            )
    except Exception:
        if isinstance(cached, list) and len(cached) > 0:
            return list(cached)
        records = [
            InfinitoNexusVersionRecord(
                value="latest",
                label="latest",
                git_tag=None,
                image_tag="latest",
                commit_sha=None,
            )
        ]

    with _CACHE_LOCK:
        _CACHE["records"] = list(records)
        _CACHE["expires_at"] = now + ttl if ttl > 0 else now
    return list(records)


def resolve_infinito_nexus_record(version: str | None) -> InfinitoNexusVersionRecord:
    normalized = normalize_infinito_nexus_version(version)
    for record in list_infinito_nexus_versions():
        if record.value == normalized:
            return record
    raise HTTPException(
        status_code=400,
        detail=f"unsupported infinito_nexus_version: {normalized}",
    )


def resolve_job_runner_image(version: str | None, *, base_image: str) -> str:
    record = resolve_infinito_nexus_record(version)
    return _replace_image_tag(base_image, record.image_tag)
