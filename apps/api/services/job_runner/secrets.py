from __future__ import annotations

from typing import Any, Iterable, List
import re

from api.schemas.deployment import DeploymentRequest

MASK = "********"

_SECRET_KEYWORDS = (
    "password",
    "passwd",
    "passphrase",
    "secret",
    "token",
    "private_key",
    "apikey",
    "api_key",
    "access_key",
    "client_secret",
)

_INLINE_VALUE_PATTERNS = [
    re.compile(
        r"(?i)((?:password|passwd|passphrase|secret|token|apikey|api_key|access_key|private_key)\s*[:=]\s*)([^\s]+)"
    ),
    re.compile(r"(?i)((?:sshpass\s+-p\s+))([^\s]+)"),
    re.compile(r"(?i)((?:--password\s+))([^\s]+)"),
    re.compile(r"(?i)((?:--token\s+))([^\s]+)"),
]

_TOKEN_VALUE = re.compile(
    r"(?i)(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])"
)
_JWT_VALUE = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")

_PRIVATE_KEY_BLOCK = re.compile(
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
    re.DOTALL,
)


def _is_secret_key(key: str) -> bool:
    lowered = (key or "").lower()
    return any(k in lowered for k in _SECRET_KEYWORDS)


def _looks_like_token(value: str) -> bool:
    s = value.strip()
    if not s:
        return False
    if _JWT_VALUE.match(s):
        return True
    if len(s) >= 20 and _TOKEN_VALUE.search(s):
        return True
    return False


def collect_secrets(req: DeploymentRequest) -> List[str]:
    secrets: List[str] = []

    if req.master_password:
        secrets.append(req.master_password)
    if req.auth.password:
        secrets.append(req.auth.password)
    if req.auth.private_key:
        secrets.append(req.auth.private_key)
        for line in req.auth.private_key.splitlines():
            s = line.strip()
            if s:
                secrets.append(s)
    if req.auth.passphrase:
        secrets.append(req.auth.passphrase)

    return _dedupe(secrets)


def _dedupe(items: Iterable[str]) -> List[str]:
    seen: set[str] = set()
    out: List[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def mask_secrets(text: str, secrets: Iterable[str]) -> str:
    if not text:
        return text

    redacted = text

    secret_set = {s for s in secrets if s}
    if secret_set:
        for secret in sorted(secret_set, key=len, reverse=True):
            if secret and secret in redacted:
                redacted = redacted.replace(secret, MASK)

    if _PRIVATE_KEY_BLOCK.search(redacted):
        redacted = _PRIVATE_KEY_BLOCK.sub(MASK, redacted)

    for pattern in _INLINE_VALUE_PATTERNS:
        redacted = pattern.sub(lambda m: f"{m.group(1)}{MASK}", redacted)

    if _JWT_VALUE.match(redacted):
        return MASK

    redacted = _TOKEN_VALUE.sub(lambda m: MASK, redacted)

    return redacted


def mask_mapping(value: Any, secrets: Iterable[str] | None = None) -> Any:
    secret_set = {s for s in (secrets or []) if isinstance(s, str) and s}

    if isinstance(value, dict):
        out: dict = {}
        for k, v in value.items():
            key_str = str(k)
            if _is_secret_key(key_str):
                out[k] = MASK
            else:
                out[k] = mask_mapping(v, secrets=secret_set)
        return out

    if isinstance(value, list):
        return [mask_mapping(item, secrets=secret_set) for item in value]

    if isinstance(value, str):
        if value in secret_set or _looks_like_token(value):
            return MASK
        return mask_secrets(value, secret_set)

    return value
