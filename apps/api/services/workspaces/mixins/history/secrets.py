from __future__ import annotations

import re

_SECRET_KEY_RE = re.compile(
    r"(?i)(password|passwd|passphrase|secret|token|private_key|api[_-]?key|access[_-]?key)"
)
_YAML_ASSIGN_RE = re.compile(r"^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*?)\s*$")
_ENV_ASSIGN_RE = re.compile(r"^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*$")
_VAULT_BLOCK_START_RE = re.compile(r"^\s*[A-Za-z0-9_.-]+\s*:\s*!vault\s*\|")
_BLOCK_SCALAR_RE = re.compile(r"^[>|][+-]?$")

_BINARY_SUFFIXES = (
    ".kdbx",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".zip",
    ".gz",
    ".bz2",
    ".xz",
    ".bin",
)


def is_binary_path(path: str) -> bool:
    return path.lower().endswith(_BINARY_SUFFIXES)


def contains_plaintext_secret(text: str) -> tuple[bool, int | None]:
    in_vault_block = False
    vault_block_indent = 0
    for line_number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if in_vault_block:
            if not stripped:
                continue
            current_indent = len(line) - len(line.lstrip(" "))
            if current_indent > vault_block_indent:
                continue
            in_vault_block = False

        if _VAULT_BLOCK_START_RE.match(line):
            in_vault_block = True
            vault_block_indent = len(line) - len(line.lstrip(" "))
            continue

        if not stripped or stripped.startswith("#"):
            continue

        yaml_match = _YAML_ASSIGN_RE.match(line)
        if yaml_match:
            key = yaml_match.group(1).strip()
            value = yaml_match.group(2).strip()
            if _SECRET_KEY_RE.search(key):
                if not value:
                    return True, line_number
                if value.startswith(("!vault", "$ANSIBLE_VAULT;", "{{")):
                    continue
                if value.startswith(('"{{', "'{{")):
                    continue
                if _BLOCK_SCALAR_RE.match(value):
                    return True, line_number
                if value.lower() in {"null", "~"}:
                    continue
                return True, line_number

        env_match = _ENV_ASSIGN_RE.match(line)
        if env_match:
            key = env_match.group(1).strip()
            value = env_match.group(2).strip()
            if _SECRET_KEY_RE.search(key):
                if not value:
                    continue
                if value.startswith(("{{", "$ANSIBLE_VAULT;")):
                    continue
                if value.startswith(('"{{', "'{{")):
                    continue
                return True, line_number

    return False, None
